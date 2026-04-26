// ------------------------------------------------------------------
// Component: Tauri path shim
// Responsibility: Funnel all @tauri-apps/api/path access through one
//                 module so the ESLint boundary rule (lib/** must not
//                 import @tauri-apps/* directly) holds.
// Collaborators: persistence/migrations.ts (DB backup path).
// ------------------------------------------------------------------

export async function appDataDir(): Promise<string> {
  // Lazy import keeps the Tauri global out of unit tests that never
  // touch this code path.
  const mod = await import("@tauri-apps/api/path");
  return mod.appDataDir();
}
