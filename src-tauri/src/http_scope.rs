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
use url::Url;

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
    // #308: validate each entry, registering the valid ones and
    // collecting rejects so one bad entry never blocks the rest. A
    // descriptive error is returned at the end listing what was refused.
    let mut rejected: Vec<String> = Vec::new();
    for host in hosts {
        let origin = match normalize_origin(&host) {
            Ok(o) => o,
            Err(e) => {
                rejected.push(e);
                continue;
            }
        };
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
    if !rejected.is_empty() {
        return Err(format!(
            "rejected {} host(s): {}",
            rejected.len(),
            rejected.join("; ")
        ));
    }
    Ok(())
}

// #308: validate + normalize a submitted host into a canonical origin
// "scheme://host[:port]". A compromised webview can invoke this command
// directly, so the Rust side must not trust the frontend's URL parsing:
// reject anything that is not http/https, has no host, or carries a
// path/query/fragment beyond "/". Normalizing here (rather than echoing
// the input) means the granted capability scope is always a clean origin.
fn normalize_origin(input: &str) -> Result<String, String> {
    let parsed = Url::parse(input.trim()).map_err(|e| format!("{input:?}: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("{input:?}: scheme {scheme:?} not allowed (http/https only)"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| format!("{input:?}: missing host"))?;
    if parsed.path() != "/" && !parsed.path().is_empty() {
        return Err(format!("{input:?}: path not allowed in an origin"));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(format!("{input:?}: query/fragment not allowed in an origin"));
    }
    Ok(match parsed.port() {
        Some(port) => format!("{scheme}://{host}:{port}"),
        None => format!("{scheme}://{host}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_origin() {
        assert_eq!(normalize_origin("https://openrouter.ai").unwrap(), "https://openrouter.ai");
    }

    #[test]
    fn accepts_http_origin_with_port() {
        assert_eq!(
            normalize_origin("http://localhost:11434").unwrap(),
            "http://localhost:11434"
        );
    }

    #[test]
    fn normalizes_trailing_slash() {
        assert_eq!(
            normalize_origin("https://api.example.com/").unwrap(),
            "https://api.example.com"
        );
    }

    #[test]
    fn rejects_file_scheme() {
        assert!(normalize_origin("file:///etc/passwd").is_err());
    }

    #[test]
    fn rejects_javascript_scheme() {
        assert!(normalize_origin("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_empty_string() {
        assert!(normalize_origin("").is_err());
    }

    #[test]
    fn rejects_origin_with_path() {
        assert!(normalize_origin("https://api.example.com/v1/models").is_err());
    }

    #[test]
    fn rejects_query_and_fragment() {
        assert!(normalize_origin("https://api.example.com/?x=1").is_err());
        assert!(normalize_origin("https://api.example.com/#f").is_err());
    }

    #[test]
    fn capability_id_slugifies_origin() {
        assert_eq!(capability_id("https://openrouter.ai"), "runtime-http-https---openrouter-ai");
    }
}
