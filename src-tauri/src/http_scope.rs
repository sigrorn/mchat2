// ------------------------------------------------------------------
// Component: Runtime HTTP scope registration
// Responsibility: Tauri command surface for widening the
//                 tauri-plugin-http URL allowlist at runtime (#297).
//                 Build-time-known hosts (native providers + the four
//                 built-in openai_compat presets) live statically in
//                 capabilities/default.json; custom user-added presets
//                 carry arbitrary base URLs unknown until runtime, so
//                 their host is registered here via add_capability.
//                 See ADR 012.
// Collaborators: src-tauri/src/lib.rs (registration + managed state),
//                src/lib/tauri/httpScope.ts (frontend invoke wrapper).
// ------------------------------------------------------------------

use std::collections::HashSet;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager};

// Tracks the hosts already granted this process so we never build two
// capabilities with the same identifier (Tauri requires unique ids) and
// skip redundant add_capability calls. Tauri v2 has no revocation API,
// so this only ever grows for the process lifetime.
#[derive(Default)]
pub struct RegisteredHosts(pub Mutex<HashSet<String>>);

// The http plugin scope entry shape: { "url": "<glob>" }.
#[derive(Serialize, Clone)]
struct HttpScope {
    url: String,
}

// Derive a capability identifier from a host: lowercase, non-alphanumeric
// runs collapsed to '-'. Keeps ids stable + unique per host.
fn capability_id(host: &str) -> String {
    let slug: String = host
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    format!("runtime-http-{slug}")
}

// Register one or more hosts (origins, e.g. "https://my-llm.example.com")
// into the main window's http:default scope. Idempotent: hosts already
// registered this session are skipped. Each newly granted host allows
// both the bare origin and "<origin>/*", matching the static entries.
#[tauri::command]
pub fn register_http_hosts(app: AppHandle, hosts: Vec<String>) -> Result<(), String> {
    let state = app.state::<RegisteredHosts>();
    for host in hosts {
        let origin = host.trim_end_matches('/').to_string();
        if origin.is_empty() {
            continue;
        }
        {
            let mut seen = state.0.lock().map_err(|e| e.to_string())?;
            if !seen.insert(origin.clone()) {
                continue;
            }
        }
        let allowed = vec![
            HttpScope { url: format!("{origin}/") },
            HttpScope { url: format!("{origin}/*") },
        ];
        app.add_capability(
            CapabilityBuilder::new(capability_id(&origin))
                .window("main")
                .permission_scoped("http:default", allowed, Vec::<HttpScope>::new()),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
