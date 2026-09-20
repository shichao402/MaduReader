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
pub fn run() {
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
        .invoke_handler(tauri::generate_handler![
            get_args,
            app_data_dir,
            add_allowed_path,
            set_tray_theme
        ])
        .setup(|app| {
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
