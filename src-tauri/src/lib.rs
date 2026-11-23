mod open_protocol;
mod resident;
mod relkit_sidecar;
mod updater;

use std::env;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// 托盘图标（由 npm run icons 生成同步到 src-tauri/icons/，编译期嵌入）
const TRAY_DARK: &[u8] = include_bytes!("../icons/tray-dark.png");
const TRAY_LIGHT: &[u8] = include_bytes!("../icons/tray-light.png");

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

/// ---------- 文件关联（跨平台） ----------
/// 打包层：tauri.conf.json bundle.fileAssociations 声明 .md/.markdown（NSIS 注册表 /
/// macOS Info.plist / Linux desktop 文件 MimeType），安装即出现在系统"打开方式"里。
/// 运行时层：下面三个命令供设置页在便携版/免安装场景主动注册与设为默认。

const ASSOC_EXTS: [&str; 2] = ["md", "markdown"];
#[cfg(windows)]
const ASSOC_PROGID: &str = "MaduReader.md";

#[derive(serde::Serialize)]
struct AssocStatus {
    ext: String,
    /// 本机的打开方式列表里是否已注册 Ma读（ProgID / bundle id / desktop 入口存在）
    registered: bool,
    /// 是否已是系统默认打开方式
    is_default: bool,
    /// 当前默认打开程序的可读标识
    current_handler: Option<String>,
}

#[cfg(windows)]
mod windows_assoc {
    use super::{AssocStatus, ASSOC_EXTS, ASSOC_PROGID};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
        HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE,
        REG_SZ,
    };
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn reg_set_string(
        root: HKEY,
        subkey: &str,
        value_name: Option<&str>,
        data: &str,
    ) -> Result<(), String> {
        unsafe {
            let sub_w = to_wide(subkey);
            let mut hk: HKEY = std::ptr::null_mut();
            let err = RegCreateKeyExW(
                root,
                sub_w.as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut hk,
                std::ptr::null_mut(),
            );
            if err != 0 {
                return Err(format!("RegCreateKeyExW({subkey}) failed: {err}"));
            }
            let name_w: Vec<u16> = match value_name {
                Some(n) => to_wide(n),
                None => Vec::new(),
            };
            let name_ptr = if value_name.is_some() {
                name_w.as_ptr()
            } else {
                std::ptr::null()
            };
            let mut data_w = to_wide(data);
            let err = RegSetValueExW(
                hk,
                name_ptr,
                0,
                REG_SZ,
                data_w.as_mut_ptr() as *const u8,
                (data_w.len() * 2) as u32,
            );
            RegCloseKey(hk);
            if err != 0 {
                return Err(format!("RegSetValueExW({subkey}) failed: {err}"));
            }
            Ok(())
        }
    }

    fn reg_get_string(root: HKEY, subkey: &str, value_name: &str) -> Option<String> {
        unsafe {
            let sub_w = to_wide(subkey);
            let mut hk: HKEY = std::ptr::null_mut();
            if RegOpenKeyExW(root, sub_w.as_ptr(), 0, KEY_READ, &mut hk) != 0 {
                return None;
            }
            let name_w = to_wide(value_name);
            let mut buf = [0u16; 1024];
            let mut data_len = (buf.len() * 2) as u32;
            let err = RegQueryValueExW(
                hk,
                name_w.as_ptr(),
                std::ptr::null(),
                std::ptr::null_mut(),
                buf.as_mut_ptr() as *mut u8,
                &mut data_len,
            );
            RegCloseKey(hk);
            if err != 0 {
                return None;
            }
            let chars = (data_len as usize / 2).min(buf.len());
            Some(
                String::from_utf16_lossy(&buf[..chars])
                    .trim_end_matches('\0')
                    .to_string(),
            )
        }
    }

    fn progid_registered() -> bool {
        reg_get_string(
            HKEY_CURRENT_USER,
            r"Software\Classes\MaduReader.md\shell\open\command",
            "",
        )
        .is_some()
    }

    fn current_handler(ext: &str) -> Option<String> {
        let user_choice = format!(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{ext}\UserChoice"
        );
        reg_get_string(HKEY_CURRENT_USER, &user_choice, "ProgId")
            .or_else(|| reg_get_string(HKEY_CLASSES_ROOT, &format!(".{ext}"), ""))
    }

    pub fn status() -> Vec<AssocStatus> {
        let registered = progid_registered();
        ASSOC_EXTS
            .iter()
            .map(|ext| {
                let handler = current_handler(ext);
                AssocStatus {
                    ext: ext.to_string(),
                    registered,
                    is_default: handler.as_deref() == Some(ASSOC_PROGID),
                    current_handler: handler,
                }
            })
            .collect()
    }

    /// 写入 HKCU ProgID 并加入扩展名的"打开方式"列表（无需管理员权限）。
    /// 真正的 UserChoice 默认项受系统 hash 保护无法直接写，注册后由用户在
    /// 系统"默认应用"设置或资源管理器"打开方式"里一键选择。
    pub fn set(ext: &str) -> Result<(), String> {
        if !ASSOC_EXTS.contains(&ext) {
            return Err(format!("不支持的扩展名: {ext}"));
        }
        let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
        let exe_str = exe.to_string_lossy().to_string();
        reg_set_string(
            HKEY_CURRENT_USER,
            r"Software\Classes\MaduReader.md",
            None,
            "Ma读 Markdown 文档",
        )?;
        reg_set_string(
            HKEY_CURRENT_USER,
            r"Software\Classes\MaduReader.md\shell\open\command",
            None,
            &format!("\"{exe_str}\" \"%1\""),
        )?;
        reg_set_string(
            HKEY_CURRENT_USER,
            r"Software\Classes\MaduReader.md\DefaultIcon",
            None,
            &format!("{exe_str},0"),
        )?;
        let open_with = format!(r"Software\Classes\.{ext}\OpenWithProgids");
        reg_set_string(HKEY_CURRENT_USER, &open_with, Some(ASSOC_PROGID), "")?;
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos_assoc {
    use super::{AssocStatus, ASSOC_EXTS};
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    /// 系统内置的 Markdown UTI（macOS 10.13+）
    const UTI_MARKDOWN: &str = "net.daringfireball.markdown";
    const K_LS_ROLES_ALL: u32 = 0xffff_ffff;

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSSetDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_roles: u32,
            in_handler_bundle_id: CFStringRef,
        );
        fn LSCopyDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_roles: u32,
        ) -> CFStringRef;
    }

    pub fn status(self_bundle_id: &str) -> Vec<AssocStatus> {
        let uti = CFString::new(UTI_MARKDOWN);
        let handler = unsafe {
            let raw =
                LSCopyDefaultRoleHandlerForContentType(uti.as_concrete_TypeRef(), K_LS_ROLES_ALL);
            if raw.is_null() {
                None
            } else {
                Some(CFString::wrap_under_create_rule(raw).to_string())
            }
        };
        let is_default = handler.as_deref() == Some(self_bundle_id);
        ASSOC_EXTS
            .iter()
            .map(|ext| AssocStatus {
                ext: ext.to_string(),
                registered: true,
                is_default,
                current_handler: handler.clone(),
            })
            .collect()
    }

    pub fn set(self_bundle_id: &str) -> Result<(), String> {
        let uti = CFString::new(UTI_MARKDOWN);
        let bundle = CFString::new(self_bundle_id);
        unsafe {
            LSSetDefaultRoleHandlerForContentType(
                uti.as_concrete_TypeRef(),
                K_LS_ROLES_ALL,
                bundle.as_concrete_TypeRef(),
            );
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod linux_assoc {
    use super::{AssocStatus, ASSOC_EXTS};
    use std::path::PathBuf;
    use std::process::Command;

    const MIME: &str = "text/markdown";
    const DESKTOP_CANDIDATES: [&str; 3] = [
        "madureader.desktop",
        "MaduReader.desktop",
        "com.shichao402.madureader.desktop",
    ];

    fn desktop_search_dirs() -> Vec<PathBuf> {
        let mut dirs = vec![
            PathBuf::from("/usr/share/applications"),
            PathBuf::from("/usr/local/share/applications"),
        ];
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(home).join(".local/share/applications"));
        }
        dirs
    }

    fn installed_desktop() -> Option<String> {
        for dir in desktop_search_dirs() {
            for cand in DESKTOP_CANDIDATES {
                if dir.join(cand).exists() {
                    return Some(cand.to_string());
                }
            }
        }
        None
    }

    fn query_default() -> Option<String> {
        Command::new("xdg-mime")
            .args(["query", "default", MIME])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    }

    pub fn status() -> Vec<AssocStatus> {
        let desktop = installed_desktop();
        let current = query_default();
        let is_default = desktop
            .as_deref()
            .zip(current.as_deref())
            .map(|(d, c)| d == c)
            .unwrap_or(false);
        ASSOC_EXTS
            .iter()
            .map(|ext| AssocStatus {
                ext: ext.to_string(),
                registered: desktop.is_some(),
                is_default,
                current_handler: current
                    .clone()
                    .map(|s| s.trim_end_matches(".desktop").to_string()),
            })
            .collect()
    }

    pub fn set() -> Result<(), String> {
        let desktop = installed_desktop().ok_or_else(|| {
            "未找到已安装的桌面入口，请通过 deb/rpm 安装包安装后再关联".to_string()
        })?;
        let output = Command::new("xdg-mime")
            .args(["default", &desktop, MIME])
            .output()
            .map_err(|e| format!("xdg-mime 执行失败: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "xdg-mime 失败: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(())
    }
}

/// 查询各扩展名的文件关联状态（设置页展示）
#[tauri::command]
fn association_status(app: tauri::AppHandle) -> Vec<AssocStatus> {
    #[cfg(windows)]
    {
        let _ = &app;
        return windows_assoc::status();
    }
    #[cfg(target_os = "macos")]
    {
        return macos_assoc::status(&app.config().identifier);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = &app;
        return linux_assoc::status();
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = &app;
        Vec::new()
    }
}

/// 注册/设为默认：Windows 写 HKCU ProgID 并加入"打开方式"列表；
/// macOS 直接调 LaunchServices 设为 UTI 默认；Linux 调 xdg-mime 写 mimeapps.list
#[tauri::command]
fn set_file_association(app: tauri::AppHandle, ext: String) -> Result<(), String> {
    let _ = &ext;
    #[cfg(windows)]
    {
        let _ = &app;
        return windows_assoc::set(&ext);
    }
    #[cfg(target_os = "macos")]
    {
        return macos_assoc::set(&app.config().identifier);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = &app;
        return linux_assoc::set();
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        Err("unsupported platform".to_string())
    }
}

/// Windows：打开系统"默认应用"设置页（注册后设 UserChoice 默认项需用户在此选择）
#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("打开系统设置失败: {e}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
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
        .manage(resident::ResidentState::new())
        .on_page_load(|webview, payload| resident::on_page_load(&webview, &payload))
        // 单实例常驻：二次启动（含双击 md / 命令行带参）把 argv 转发给常驻进程后立即退出。
        // 必须最先注册，尽早拦截二次启动。
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            // 二次启动进程在 log 插件初始化前退出；在常驻进程中、任何筛选前记录原始转发数据。
            // Debug 格式保留参数边界，并转义引号、换行等字符，便于还原未知参数。
            log::info!(
                "[launch] source=relaunch, resident_pid={}, cwd={:?}, argv={:?}",
                std::process::id(),
                cwd,
                argv
            );
            resident::enqueue_launch(app, "relaunch", &argv, std::path::Path::new(&cwd));
            resident::resume_main_window(app);
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
                .setup(move |app, _api: tauri::plugin::PluginApi<tauri::Wry, ()>| {
                    log::info!("[perf] rust: plugins ready at +{:?}", boot_start.elapsed());
                    // log 已就绪；在前端消费参数之前记录含 exe 的原始启动参数。
                    // args_os 避免仅为记录日志而对非 Unicode 参数触发 panic。
                    log::info!(
                        "[launch] source=cold-start, pid={}, version={}, cwd={:?}, argv={:?}",
                        std::process::id(),
                        env!("CARGO_PKG_VERSION"),
                        env::current_dir(),
                        env::args_os().collect::<Vec<_>>()
                    );
                    let argv = env::args_os().map(|arg| arg.to_string_lossy().into_owned()).collect::<Vec<String>>();
                    match env::current_dir() {
                        Ok(cwd) => resident::enqueue_launch(app, "cold-start", &argv, &cwd),
                        Err(error) => resident::enqueue(app, "cold-start", Vec::new(), Some(format!("无法读取启动工作目录: {error}"))),
                    }
                    Ok(())
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            resident::frontend_begin,
            resident::frontend_ready,
            resident::next_open_request,
            resident::complete_open_request,
            resident::app_ready,
            app_data_dir,
            add_allowed_path,
            set_tray_theme,
            read_data_file,
            write_data_file,
            association_status,
            set_file_association,
            open_default_apps_settings,
            updater::update_status,
            updater::update_check,
            updater::update_download,
            updater::update_apply
        ])
        .setup(move |app| {
            // Relkit 启动交接：引擎要求宿主让位（正在替换安装目录）时立即退出；问不到引擎一律放行
            if updater::host_must_exit() {
                log::warn!("[relkit] 引擎要求宿主退出（更新进行中），本次启动让位");
                std::process::exit(0);
            }
            #[cfg(windows)]
            if let Some(ms) = process_load_ms {
                log::info!("[perf] rust: process->run() = {}ms (exe 加载/静态初始化段)", ms);
            }
            log::info!("[perf] rust: setup entered at +{:?}", boot_start.elapsed());

            app.manage(updater::UpdateState::new(app.handle()));
            updater::start(app.handle());

            resident::install_close_handler(app);

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
                        "show" => resident::resume_main_window(app),
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
                            resident::resume_main_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }

            log::info!("[perf] rust: setup done at +{:?}", boot_start.elapsed());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Finder / LaunchServices 不一定经过 argv，统一进入同一队列。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                log::info!("[launch] source=system-open urls={urls:?}");
                let mut paths = Vec::new();
                let mut error = None;
                for url in urls {
                    match url.to_file_path() {
                        Ok(path) => paths.push(path.to_string_lossy().into_owned()),
                        Err(()) => error = Some(format!("不支持的打开地址: {url}")),
                    }
                }
                resident::enqueue(_app, "system-open", paths, error);
                resident::resume_main_window(_app);
            }
        });
}
