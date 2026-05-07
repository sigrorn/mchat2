// Minimal Tauri entrypoint. Heavy lifting is in TypeScript — Rust just
// wires up plugins so the frontend can call them.

mod keychain;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // #284: register single-instance FIRST. The init callback fires
        // on the running process whenever a second mchat2.exe is
        // launched; we focus the existing window and the second process
        // exits before reaching DB-open (its tauri_plugin_sql call would
        // otherwise race the running process's writer lock — see #267
        // / ADR 011 for why the JS op queue can't help across processes).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            keychain::keychain_get,
            keychain::keychain_set,
            keychain::keychain_remove,
            keychain::keychain_list,
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
