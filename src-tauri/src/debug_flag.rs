// ------------------------------------------------------------------
// Component: Debug flag command
// Responsibility: Expose a single bool to the frontend indicating
//                 whether the app was launched with MCHAT2_DEBUG set
//                 (parity with old mchat's -debug). Read once at
//                 process start so toggling the env mid-run has no
//                 effect — matches the user's mental model where
//                 tracing is per-launch, not per-setting.
// Collaborators: src-tauri/src/lib.rs (registration), src/lib/
//                tauri/debugFlag.ts (frontend).
// ------------------------------------------------------------------

use std::sync::OnceLock;

static ENABLED: OnceLock<bool> = OnceLock::new();

fn read_env_once() -> bool {
    *ENABLED.get_or_init(|| match std::env::var("MCHAT2_DEBUG") {
        Ok(v) => matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "on"),
        Err(_) => false,
    })
}

#[tauri::command]
pub async fn debug_enabled() -> bool {
    read_env_once()
}
