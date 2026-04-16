// ------------------------------------------------------------------
// Component: Debug flag (frontend facade)
// Responsibility: One-time read of the Rust-side MCHAT2_DEBUG env var.
//                 Cached promise so concurrent callers share the same
//                 invoke and we never round-trip more than once per
//                 process. Per-launch toggle, not a persisted setting.
// Collaborators: src-tauri/src/debug_flag.rs.
// ------------------------------------------------------------------

let cached: Promise<boolean> | null = null;

export function isDebugEnabled(): Promise<boolean> {
  if (cached) return cached;
  cached = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("debug_enabled");
    } catch {
      return false;
    }
  })();
  return cached;
}

// Test-only: reset the cache so a unit test can stub a different value.
export function __resetDebugFlagCache(): void {
  cached = null;
}
