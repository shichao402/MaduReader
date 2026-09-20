use std::env;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// 托盘图标（由 npm run icons 生成同步到 src-tauri/icons/，编译期嵌入）
const TRAY_DARK: &[u8] = include_bytes!("../icons/tray-dark.png");
const TRAY_LIGHT: &[u8] = include_bytes!("../icons/tray-light.png");

fn decode_tray_icon(bytes: &'static [u8]) -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(bytes).map(|img| img.to_owned())
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn get_args() -> Vec<String> {
    env::args().skip(1).collect()
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
        .map_err(|e| format!("failed to decode tray icon: {e}"))?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
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
                        "show" => focus_main_window(app),
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
                            focus_main_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }
            log::info!("[perf] rust: setup done at +{:?}", boot_start.elapsed());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
