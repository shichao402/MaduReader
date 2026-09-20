use std::env;
use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// 托盘图标（由 npm run icons 生成同步到 src-tauri/icons/，编译期嵌入）
const TRAY_DARK: &[u8] = include_bytes!("../icons/tray-dark.png");
const TRAY_LIGHT: &[u8] = include_bytes!("../icons/tray-light.png");

/// 常驻 + 快速唤醒协议：
/// - 点 X 关窗（或 Alt+F4）→ 窗口立即隐藏（体感即关），进程与 WebView2 环境常驻；500ms
///   （前端会话落盘窗口）后把 WebView 导航到 about:blank，DOM/JS 堆整体释放。
///   是否驻留由设置项 closeToTray 控制。
/// - 再次启动 exe / 双击 md → single-instance 把参数转发给常驻进程后本进程立即退出，常驻进程
///   导航回应用页面，前端 init 通过 get_pending_open 拿到路径直接打开。
/// - 托盘左键 / "显示主窗口" → 内容已卸载则先导航回来，暂不显示窗口；等前端 init 完成、
///   画面绘制后上报 app_ready 再显示（超时兜底强制显示），避免白屏/半渲染画面外露。
const BLANK_URL: &str = "about:blank";
/// 与前端会话防抖间隔（500ms）一致，保证隐藏前 session.json 已落盘
const SESSION_SETTLE_MS: u64 = 500;

/// 可变运行状态（Mutex 内部可变性：Tauri State 只提供共享引用）
struct ResidentInner {
    /// WebView 内容是否已卸载（隐藏 + about:blank），唤醒时据此决定是否导航回来
    unloaded: bool,
    /// 唤醒时窗口处于隐藏等待状态：app_ready 上报后再显示，超时兜底
    pending_show: bool,
    /// 应用页面前端 URL（dev 为 devUrl、release 为应用协议地址），唤醒导航用
    app_url: String,
    /// single-instance 转发的待打开路径，页面导航回来后由前端 init 消费（consume-once）
    pending_open: Option<String>,
    /// 原始命令行参数只消费一次：常驻唤醒后页面重载会再次调 get_args，
    /// 不能再返回旧 argv，否则会反复打开启动参数文件而不是恢复最新会话
    args_consumed: bool,
    /// 关闭卸载流程的 500ms 等待窗口内若发生二次启动，取消隐藏/卸载
    cancel_unload: bool,
}

impl ResidentInner {
    fn new() -> Self {
        Self {
            unloaded: false,
            pending_show: false,
            app_url: String::new(),
            pending_open: None,
            args_consumed: false,
            cancel_unload: false,
        }
    }
}

struct ResidentState {
    inner: Mutex<ResidentInner>,
}

impl ResidentState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(ResidentInner::new()),
        }
    }

    fn with_inner<R>(&self, f: impl FnOnce(&mut ResidentInner) -> R) -> R {
        let mut guard = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut guard)
    }
}

/// 读取「关闭窗口时驻留托盘」设置（config.json 由前端 write_data_file 维护）。
/// 文件缺失/损坏/字段缺失时默认驻留（true）。
fn close_to_tray_enabled() -> bool {
    dirs::data_dir()
        .map(|dir| dir.join("madureader").join("config.json"))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|text| text.trim_start_matches('\u{feff}').to_string())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("closeToTray").and_then(|v| v.as_bool()))
        .unwrap_or(true)
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 前端已在运行时，直接推 madu:open-path 事件打开路径（含目录/文件逻辑由前端统一处理）
fn emit_open_path(app: &tauri::AppHandle, path: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let payload = serde_json::to_string(&path).unwrap_or_else(|_| "\"\"".to_string());
        let _ = win.eval(&format!(
            "window.dispatchEvent(new CustomEvent('madu:open-path', {{ detail: {payload} }}))"
        ));
    }
}

/// 唤醒主窗口：若 WebView 内容已卸载（about:blank），先导航回应用页面再聚焦。
/// 页面重新加载后前端 init 会自行调用 get_pending_open 处理待打开路径或会话恢复。
/// 已卸载时窗口保持隐藏，等前端绘制完成后上报 app_ready 再显示（1s 超时兜底），
/// 避免白屏/半渲染画面外露（画面撕裂感）。
fn resume_main_window(app: &tauri::AppHandle) {
    let mut wait_ready = false;
    if let Some(state) = app.try_state::<ResidentState>() {
        let app_url = state.with_inner(|inner| {
            if inner.unloaded {
                inner.unloaded = false;
                inner.pending_show = true;
                wait_ready = true;
            }
            inner.app_url.clone()
        });
        if let Some(win) = app.get_webview_window("main") {
            match app_url.parse::<tauri::Url>() {
                Ok(url) => {
                    let _ = win.navigate(url);
                    log::info!("[resident] webview navigating back to {}", app_url);
                }
                Err(_) => {
                    let _ = win.eval("window.location.reload()");
                }
            }
        }
        if wait_ready {
            let handle = app.clone();
            std::thread::spawn(move || {
                for _ in 0..20 {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    let still_waiting = handle
                        .try_state::<ResidentState>()
                        .map(|s| s.with_inner(|inner| inner.pending_show))
                        .unwrap_or(false);
                    if !still_waiting {
                        return;
                    }
                }
                // 超时兜底：前端迟迟未上报（如异常），强制显示避免窗口"消失"
                handle
                    .try_state::<ResidentState>()
                    .map(|s| s.with_inner(|inner| inner.pending_show = false));
                focus_main_window(&handle);
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.show();
                }
                log::warn!("[resident] app_ready timeout, force show window");
            });
        }
    }
    focus_main_window(app);
}

/// 前端 init 完成、首帧绘制后调用：若窗口正等待显示，则显示并聚焦。
#[tauri::command]
fn app_ready(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<ResidentState>() {
        let should_show = state.with_inner(|inner| {
            if inner.pending_show {
                inner.pending_show = false;
                true
            } else {
                false
            }
        });
        if should_show {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
            log::info!("[resident] app_ready, window shown");
        }
    }
}

#[tauri::command]
fn get_args(app: tauri::AppHandle) -> Vec<String> {
    if let Some(state) = app.try_state::<ResidentState>() {
        let already = state.with_inner(|inner| {
            if inner.args_consumed {
                true
            } else {
                inner.args_consumed = true;
                false
            }
        });
        if already {
            return Vec::new();
        }
    }
    env::args().skip(1).collect()
}

/// 前端 init 时上报自己页面的真实 URL（dev 为 devUrl、release 为应用协议地址）。
/// 卸载后再唤醒时 WebView 已在 about:blank，JS 上下文已销毁，只能靠这个记录导航回去。
#[tauri::command]
fn set_app_url(app: tauri::AppHandle, url: String) {
    if url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("tauri://")
        || url.starts_with("http://tauri.localhost")
    {
        if let Some(state) = app.try_state::<ResidentState>() {
            state.with_inner(|inner| inner.app_url = url);
        }
    }
}

/// 前端启动后询问：本次唤醒是否有待打开的路径（single-instance 转发）。
/// 取走即清空（consume-once）；None 表示走会话恢复。
#[tauri::command]
fn get_pending_open(app: tauri::AppHandle) -> Option<String> {
    app.try_state::<ResidentState>()
        .and_then(|state| state.with_inner(|inner| inner.pending_open.take()))
}

#[tauri::command]
fn app_data_dir() -> Result<String, String> {
    dirs::data_dir()
        .map(|dir| {
            let path = dir.join("madureader");
            let mut s = path.to_string_lossy().into_owned();
            if !s.ends_with(std::path::MAIN_SEPARATOR) {
                s.push(std::path::MAIN_SEPARATOR);
            }
            s
        })
        .ok_or_else(|| "Could not resolve app data directory".to_string())
}

/// 将用户显式授权的路径（目录或文件）加入 fs 读取作用域。
/// 目录递归放行，覆盖所有层级的子目录与文件。
/// 仅可由前端在用户通过对话框选择或拖拽文件后调用，不做无差别的全盘授权。
#[tauri::command]
fn add_allowed_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_fs::FsExt as _;
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {path}"));
    }
    let scope = app.fs_scope();
    let result = if p.is_dir() {
        scope.allow_directory(&p, true)
    } else {
        scope.allow_file(&p)
    };
    result.map_err(|e| format!("failed to allow path: {e}"))
}

/// 应用数据文件统一由 Rust 侧读写，绕开前端 fs 插件作用域限制，
/// 写入前自动创建目录，避免持久化被静默拦截导致设置丢失。
/// 仅允许 madureader 数据目录下的普通文件名，拒绝任何路径分隔符。
fn data_file_path(file_name: &str) -> Result<std::path::PathBuf, String> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
    {
        return Err(format!("invalid file name: {file_name}"));
    }
    let dir = dirs::data_dir()
        .ok_or_else(|| "Could not resolve app data directory".to_string())?
        .join("madureader");
    Ok(dir.join(file_name))
}

#[tauri::command]
fn read_data_file(file_name: String) -> Result<String, String> {
    let path = data_file_path(&file_name)?;
    std::fs::read_to_string(&path).map_err(|e| format!("failed to read {file_name}: {e}"))
}

#[tauri::command]
fn write_data_file(file_name: String, content: String) -> Result<(), String> {
    let path = data_file_path(&file_name)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("failed to create dir: {e}"))?;
    }
    std::fs::write(&path, content).map_err(|e| format!("failed to write {file_name}: {e}"))
}

/// 前端主题切换时同步托盘图标深浅（dark=true 用白色图形）。
#[tauri::command]
fn set_tray_theme(app: tauri::AppHandle, dark: bool) -> Result<(), String> {
    let icon = decode_tray_icon(if dark { TRAY_DARK } else { TRAY_LIGHT })
        .map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn decode_tray_icon(bytes: &'static [u8]) -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(bytes).map(|img| img.to_owned())
}

/// 进程创建到 run() 进入的耗时（exe 加载 + 静态初始化段，Defender 实时扫描主要发生在这一段）。
/// 通过 GetProcessTimes 取进程创建时刻，与当前时间做差；日志插件未就绪，由 setup 内统一输出。
#[cfg(windows)]
fn process_start_elapsed_ms() -> Option<u64> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    let mut creation = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let mut exit = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let mut kernel = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let mut user = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };

    unsafe {
        if GetProcessTimes(GetCurrentProcess(), &mut creation, &mut exit, &mut kernel, &mut user) == 0 {
            return None;
        }
    }

    let created = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
    let now_unix_100ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos() as u64
        / 100;
    // FILETIME 纪元（1601-01-01）与 UNIX 纪元相差的 100ns 数
    const EPOCH_DIFF_100NS: u64 = 116_444_736_000_000_000;
    let now_filetime = now_unix_100ns + EPOCH_DIFF_100NS;
    if now_filetime <= created {
        return None;
    }
    Some((now_filetime - created) / 10_000)
}

pub fn run() {
    let boot_start = std::time::Instant::now();
    #[cfg(windows)]
    let process_load_ms = process_start_elapsed_ms();
    tauri::Builder::default()
        // 单实例常驻：二次启动（含双击 md / 命令行带参）把 argv 转发给常驻进程后立即退出。
        // 必须最先注册，尽早拦截二次启动。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 二次启动发生时，若关闭卸载流程还在等待窗口内，取消它
            if let Some(state) = app.try_state::<ResidentState>() {
                state.with_inner(|inner| inner.cancel_unload = true);
            }
            // 插件把 cwd 与 exe 路径一并放进 argv：argv[0]=cwd、argv[1]=exe 路径、argv[2]=真实参数。
            // 跳过与当前进程 exe 相同的项，取第一个真实目标（兼容插件未来调整约定）。
            let exe_path = std::env::current_exe()
                .ok()
                .map(|p| p.to_string_lossy().to_lowercase());
            let target = argv
                .iter()
                .skip(1)
                .find(|a| {
                    let lower = a.to_lowercase();
                    Some(lower.as_str()) != exe_path.as_deref()
                })
                .cloned();
            let was_unloaded = app
                .try_state::<ResidentState>()
                .map(|s| s.with_inner(|inner| inner.unloaded))
                .unwrap_or(false);
            // 内容已卸载：记下待打开路径，页面导航回来后由 init 调 get_pending_open 消费
            if was_unloaded {
                if let (Some(state), Some(path)) = (app.try_state::<ResidentState>(), target.as_ref()) {
                    state.with_inner(|inner| inner.pending_open = Some(path.clone()));
                }
                // 窗口此刻是隐藏的，显示动作交给 resume_main_window 的 app_ready 流程
            } else {
                // 内容未卸载、窗口可见：直接置顶显示（focus_main_window 走 unminimize+set_focus）
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
            }
            resume_main_window(app);
            // 内容未卸载：前端已在运行，直接推事件打开文件（不置 pending，避免残留污染下次唤醒）
            if !was_unloaded {
                if let Some(path) = target {
                    emit_open_path(app, &path);
                }
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: Some("madureader".into()) },
                ))
                .max_file_size(512_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        // 探针插件：注册在 log 之后，其 initialize 完成即「插件全部就绪」，
        // 与 setup entered 之差即「主窗口 + WebView2 创建」耗时
        .plugin(
            tauri::plugin::Builder::new("startup-probe")
                .setup(move |_app, _api: tauri::plugin::PluginApi<tauri::Wry, ()>| {
                    log::info!("[perf] rust: plugins ready at +{:?}", boot_start.elapsed());
                    Ok(())
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_args,
            get_pending_open,
            set_app_url,
            app_ready,
            app_data_dir,
            add_allowed_path,
            set_tray_theme,
            read_data_file,
            write_data_file
        ])
        .setup(move |app| {
            #[cfg(windows)]
            if let Some(ms) = process_load_ms {
                log::info!("[perf] rust: process->run() = {}ms (exe 加载/静态初始化段)", ms);
            }
            log::info!("[perf] rust: setup entered at +{:?}", boot_start.elapsed());

            app.manage(ResidentState::new());

            // 记录应用页面前端 URL（dev 为 devUrl，release 为 tauri://localhost），唤醒导航用；
            // 前端 init 时还会通过 set_app_url 上报更可靠的地址
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(url) = win.url() {
                    let text = url.to_string();
                    app.state::<ResidentState>().with_inner(|inner| {
                        if !text.starts_with("about:") {
                            inner.app_url = text;
                        }
                    });
                }
            }

            #[cfg(desktop)]
            {
                let show =
                    MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                let icon = decode_tray_icon(TRAY_LIGHT)?;
                TrayIconBuilder::with_id("main-tray")
                    .icon(icon)
                    .tooltip("Ma读")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => resume_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            resume_main_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }

            // 常驻核心：拦截点 X 关闭。closeToTray 开启时立即隐藏窗口（体感即关），
            // 隐藏后通知前端落盘会话，500ms 后卸载 WebView 内容（导航到 about:blank）。
            if let Some(win) = app.get_webview_window("main") {
                let win_for_flush = win.clone();
                let win_for_hide = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if !close_to_tray_enabled() {
                            return;
                        }
                        api.prevent_close();
                        // 立即隐藏：用户点 X 的那一刻窗口就消失，体感与"关闭"一致
                        let _ = win_for_hide.hide();
                        // 窗口已隐藏，此刻通知前端立即落盘会话
                        let _ = win_for_flush.eval(
                            "window.dispatchEvent(new CustomEvent('madu:hide-before-close'))",
                        );
                        let hide_win = win_for_hide.clone();
                        std::thread::spawn(move || {
                            // 给前端写入 session.json 留出落盘窗口（窗口已隐藏，无感知）
                            std::thread::sleep(std::time::Duration::from_millis(SESSION_SETTLE_MS));
                            // 等待窗口内发生二次启动：放弃卸载，保持窗口可见
                            let cancelled = hide_win
                                .app_handle()
                                .try_state::<ResidentState>()
                                .map(|s| {
                                    s.with_inner(|inner| std::mem::replace(&mut inner.cancel_unload, false))
                                })
                                .unwrap_or(false);
                            if cancelled {
                                log::info!("[resident] close cancelled by relaunch, window stays visible");
                                return;
                            }
                            // 内容卸载：导航到空白页，释放 DOM/JS 堆；唤醒时导航回来重新初始化
                            if let Ok(blank) = tauri::Url::parse(BLANK_URL) {
                                let _ = hide_win.navigate(blank);
                            }
                            if let Some(state) =
                                hide_win.app_handle().try_state::<ResidentState>()
                            {
                                state.with_inner(|inner| inner.unloaded = true);
                            }
                            log::info!("[resident] window hidden, webview content unloaded");
                        });
                    }
                });
            }

            log::info!("[perf] rust: setup done at +{:?}", boot_start.elapsed());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
