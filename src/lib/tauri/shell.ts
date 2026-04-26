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

export const shell = {
  open: (url: string) => impl.open(url),
};

export function __setImpl(mock: ShellImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = defaultImpl;
}
