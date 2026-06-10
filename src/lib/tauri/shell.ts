// ------------------------------------------------------------------
// Component: Shell
// Responsibility: Thin shim over @tauri-apps/plugin-shell so the
//                 boundary rule (#142) doesn't get tripped by direct
//                 plugin imports inside src/lib/** or feature modules.
//                 Currently exposes only `open(url)` for launching a
//                 URL in the system browser — the Register links on
//                 Settings · Providers (#170) call this.
// Collaborators: components/SettingsDialog (Register links),
//                lib/testing/installBrowserMocks (test seam).
// ------------------------------------------------------------------

export interface ShellImpl {
  open(url: string): Promise<void>;
}

const defaultImpl: ShellImpl = {
  async open(url: string) {
    const mod = await import("@tauri-apps/plugin-shell");
    await mod.open(url);
  },
};

let impl: ShellImpl = defaultImpl;

// #307: belt-and-braces scheme check above the Tauri capability layer.
// The app only ever opens provider/registration https links, so refuse
// anything that is not http/https before invoking the plugin — a
// compromised webview must not be able to open() file:// paths or
// custom-scheme URLs (protocol-handler attacks). The plugin's own
// `plugins.shell.scope.open` regex enforces the same at the Rust layer.
function assertWebUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`shell.open: refusing to open non-URL value`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`shell.open: refusing to open ${parsed.protocol} URL — only http/https allowed`);
  }
}

export const shell = {
  // async so a rejected scheme surfaces as a rejected promise (callers
  // use `.catch()`), never a synchronous throw.
  open: async (url: string) => {
    assertWebUrl(url);
    await impl.open(url);
  },
};

export function __setImpl(mock: ShellImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = defaultImpl;
}
