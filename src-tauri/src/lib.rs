mod dl;
mod shell_path;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(dl::Jobs::default())
        .invoke_handler(tauri::generate_handler![dl::tools, dl::default_dir, dl::probe, dl::start, dl::cancel])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
