// Minimal Tauri entrypoint. Heavy lifting is in TypeScript — Rust just
// wires up plugins so the frontend can call them.

mod debug_flag;
mod keychain;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            keychain::keychain_get,
            keychain::keychain_set,
            keychain::keychain_remove,
            keychain::keychain_list,
            debug_flag::debug_enabled,
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
