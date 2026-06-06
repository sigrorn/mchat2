// ------------------------------------------------------------------
// Component: HTTP scope registration (frontend)
// Responsibility: Thin invoke() wrapper over the Rust
//                 `register_http_hosts` command (#297) plus the helper
//                 that enumerates the openai_compat preset hosts the
//                 app needs to reach. Built-in preset hosts are also
//                 in the static capabilities allowlist; registering
//                 them here too is harmless (Rust dedups) and the
//                 custom-preset hosts can ONLY be granted this way.
//                 See ADR 012.
// Collaborators: src-tauri/src/http_scope.rs (command),
//                providers/openaiCompatPresets, openaiCompatStorage.
// ------------------------------------------------------------------

import { BUILTIN_OPENAI_COMPAT_PRESETS } from "../providers/openaiCompatPresets";
import { loadOpenAICompatConfig } from "../providers/openaiCompatStorage";

export interface HttpScopeImpl {
  registerHosts(hosts: string[]): Promise<void>;
}

const defaultImpl: HttpScopeImpl = {
  async registerHosts(hosts: string[]): Promise<void> {
    if (hosts.length === 0) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("register_http_hosts", { hosts });
  },
};

let impl: HttpScopeImpl = defaultImpl;

export const httpScope = {
  registerHosts: (hosts: string[]) => impl.registerHosts(hosts),
};

export function __setImpl(mock: HttpScopeImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = defaultImpl;
}

// Extract the origin ("https://host[:port]") from a (possibly templated)
// URL. Built-in templates carry `{VAR}` placeholders only in the PATH,
// so the host parses fine and the origin is stable. Returns null for
// anything that isn't a parseable absolute URL.
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Collect every openai_compat host the app may call: the built-in
// presets (static URLs / static hosts) plus the user's custom presets
// (arbitrary base URLs). De-duplicated; order is not significant.
export async function gatherProviderHosts(): Promise<string[]> {
  const origins = new Set<string>();
  for (const preset of BUILTIN_OPENAI_COMPAT_PRESETS) {
    const o = originOf(preset.urlTemplate);
    if (o) origins.add(o);
  }
  const cfg = await loadOpenAICompatConfig();
  for (const custom of cfg.customs) {
    const o = originOf(custom.baseUrl);
    if (o) origins.add(o);
  }
  return [...origins];
}
