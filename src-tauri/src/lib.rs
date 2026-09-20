use std::env;

use tauri::Manager;

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
        .invoke_handler(tauri::generate_handler![get_args, app_data_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
