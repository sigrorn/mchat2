// ------------------------------------------------------------------
// Component: Crash log
// Responsibility: Install global window.onerror / unhandledrejection
//                 handlers that append a one-line entry to
//                 <appDataDir>/crash.log so production webview crashes
//                 leave a forensic trail without devtools open.
//                 Survives only the JS-exception variant of a crash —
//                 a true renderer/GPU-process death takes the whole
//                 JS context with it before we can write. That's the
//                 tradeoff: we catch the failures that warn before
//                 they cascade into a black window, and miss the ones
//                 that don't.
// Collaborators: main.tsx (boot wiring), tauri/filesystem (append).
// ------------------------------------------------------------------

import { fs } from "../tauri/filesystem";
import { appDataDir } from "../tauri/path";

const STACK_LIMIT = 4_000;

let installed = false;
let pathPromise: Promise<string> | null = null;

async function logFilePath(): Promise<string> {
  if (!pathPromise) {
    pathPromise = (async () => {
      const dir = await appDataDir();
      const sep = dir.includes("\\") ? "\\" : "/";
      return `${dir}${sep}crash.log`;
    })();
  }
  return pathPromise;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[+${s.length - max}]` : s;
}

function formatEntry(kind: "error" | "unhandledrejection", payload: {
  message: string;
  stack?: string | null;
  source?: string | null;
  lineno?: number | null;
  colno?: number | null;
}): string {
  const ts = new Date().toISOString();
  const version =
    typeof __BUILD_INFO__ !== "undefined" ? __BUILD_INFO__.version : "unknown";
  const at =
    payload.source && payload.lineno
      ? ` at ${payload.source}:${payload.lineno}${payload.colno ? `:${payload.colno}` : ""}`
      : "";
  const stack = payload.stack
    ? `\n${truncate(payload.stack, STACK_LIMIT)}`
    : "";
  return `[${ts}] v${version} ${kind}: ${payload.message}${at}${stack}\n---\n`;
}

async function append(entry: string): Promise<void> {
  try {
    const path = await logFilePath();
    await fs.appendText(path, entry);
  } catch {
    // Swallow — losing one crash log entry is better than a runaway
    // recursion of error handlers. Devtools (Ctrl+Shift+I) is the
    // fallback when the file path itself is the problem.
  }
}

function describeError(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack ?? null };
  }
  if (typeof err === "string") return { message: err, stack: null };
  try {
    return { message: JSON.stringify(err), stack: null };
  } catch {
    return { message: String(err), stack: null };
  }
}

export function installCrashLog(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e: ErrorEvent) => {
    const described = describeError(e.error ?? e.message);
    void append(
      formatEntry("error", {
        message: described.message,
        stack: described.stack,
        source: e.filename || null,
        lineno: e.lineno || null,
        colno: e.colno || null,
      }),
    );
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const described = describeError(e.reason);
    void append(
      formatEntry("unhandledrejection", {
        message: described.message,
        stack: described.stack,
      }),
    );
  });
}
