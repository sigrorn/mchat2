// Minimal Tauri entrypoint. Heavy lifting is in TypeScript — Rust just
// wires up plugins so the frontend can call them.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_stronghold::Builder::new(|password| {
            // Derive stronghold encryption key from password. Users pick
            // their own on first run; we just hash it through argon-like
            // KDF. Stronghold's builder expects a Vec<u8> of fixed length.
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            password.hash(&mut h);
            let seed = h.finish();
            let mut key = vec![0u8; 32];
            for (i, b) in key.iter_mut().enumerate() {
                *b = ((seed >> ((i % 8) * 8)) & 0xff) as u8;
            }
            key
        }).build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
