// ------------------------------------------------------------------
// Component: Trace base-dir resolver
// Responsibility: Decide the base directory under which trace files
//                 (./debug/...) are written. When the user has
//                 explicitly chosen a working dir, honor it; otherwise
//                 default to the app-data dir ($APPDATA/...), which the
//                 fs capability already grants. This lets tracing work
//                 on a fresh profile without home-wide fs access and is
//                 the prerequisite for narrowing the fs scope (#305/#306).
// Collaborators: tauri/path shim (appDataDir), traceFileSink (consumer).
// ------------------------------------------------------------------

import { appDataDir } from "../tauri/path";

// `appDataDirFn` is injectable so the fallback is unit-testable without
// the Tauri runtime; production uses the real path shim.
export async function resolveTraceBaseDir(
  workingDir: string | null | undefined,
  appDataDirFn: () => Promise<string> = appDataDir,
): Promise<string> {
  const explicit = workingDir?.trim();
  if (explicit) return explicit;
  return appDataDirFn();
}
