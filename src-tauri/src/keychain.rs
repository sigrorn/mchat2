// ------------------------------------------------------------------
// Component: OS keychain commands
// Responsibility: Tauri command surface for the OS-native keychain
//                 (#35). Thin wrappers around the `keyring` crate so
//                 the frontend can invoke() them exactly the same way
//                 it used to call the Stronghold plugin.
// Collaborators: src-tauri/src/lib.rs (registration), src/lib/tauri/
//                keychain.ts (frontend).
// ------------------------------------------------------------------

use keyring::Entry;

const SERVICE: &str = "mchat2";
// Special entry holding a JSON array of all keys currently stored.
// Maintained by set/remove so the frontend can enumerate secrets (used
// by the HTML export redaction path).
const INDEX_KEY: &str = "__index__";

fn load_index() -> Vec<String> {
    let Ok(entry) = Entry::new(SERVICE, INDEX_KEY) else {
        return Vec::new();
    };
    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_index(keys: &[String]) -> Result<(), String> {
    let entry = Entry::new(SERVICE, INDEX_KEY).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(keys).map_err(|e| e.to_string())?;
    entry.set_password(&json).map_err(|e| e.to_string())
}

fn add_to_index(key: &str) -> Result<(), String> {
    let mut keys = load_index();
    if !keys.iter().any(|k| k == key) {
        keys.push(key.to_string());
        save_index(&keys)?;
    }
    Ok(())
}

fn remove_from_index(key: &str) -> Result<(), String> {
    let mut keys = load_index();
    let before = keys.len();
    keys.retain(|k| k != key);
    if keys.len() != before {
        save_index(&keys)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn keychain_get(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn keychain_set(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())?;
    add_to_index(&key)?;
    Ok(())
}

#[tauri::command]
pub async fn keychain_remove(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => {}
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }
    remove_from_index(&key)?;
    Ok(())
}

// #308: keychain_list stays (not deleted). It returns only the keys
// mchat2 itself wrote under the "mchat2" service, tracked in the
// __index__ entry by set/remove — never the wider OS keychain. It is
// genuinely needed for *dynamic* enumeration the TS layer cannot derive
// statically: openai_compat custom presets store keys under arbitrary
// sub-keys ("<base>.<presetId>"), and ProviderSpendTable / the HTML
// export redaction path must discover which exist. Since the provider
// set is otherwise static, the residual XSS amplification is limited to
// those user-created preset keys, which the index already scopes.
#[tauri::command]
pub async fn keychain_list() -> Result<Vec<String>, String> {
    Ok(load_index())
}
