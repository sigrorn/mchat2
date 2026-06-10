// ------------------------------------------------------------------
// Component: Production CSP guard (#304, part of #115)
// Responsibility: Lock in that the Tauri webview ships a non-null
//                 Content-Security-Policy and, critically, that
//                 `script-src` stays `'self'` with no unsafe escapes.
//                 In a Tauri app a renderer XSS reaches every
//                 registered invoke() command (keychain, fs, sql,
//                 http-scope), so the CSP — and especially a locked
//                 script-src — is the defense-in-depth layer behind
//                 the rendering pipeline.
// Collaborators: src-tauri/tauri.conf.json (app.security.csp).
// ------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Parse a CSP string ("a 'self'; b x y") into a directive→sources map.
function parseCsp(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    out[name!] = sources;
  }
  return out;
}

describe("production CSP (#304)", () => {
  const conf = JSON.parse(
    readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  ) as { app?: { security?: { csp?: unknown } } };
  const csp = conf.app?.security?.csp;

  it("is set (non-null) — the webview must not run wide open", () => {
    expect(csp).not.toBeNull();
    expect(typeof csp).toBe("string");
  });

  it("restricts script-src to 'self' with no unsafe-inline / unsafe-eval", () => {
    const dirs = parseCsp(csp as string);
    // Tauri auto-appends nonces/hashes for its own injected scripts, so
    // 'self' is sufficient and unsafe-* must never be added here — that
    // is the directive a renderer XSS would need.
    expect(dirs["script-src"]).toEqual(["'self'"]);
  });

  it("defaults to 'self' and does not allow arbitrary network connect", () => {
    const dirs = parseCsp(csp as string);
    expect(dirs["default-src"]).toContain("'self'");
    // Provider HTTP goes through tauri-plugin-http (Rust side), not
    // browser fetch, so connect-src needs only IPC origins — never '*'.
    expect(dirs["connect-src"]).toBeDefined();
    expect(dirs["connect-src"]).not.toContain("*");
  });
});
