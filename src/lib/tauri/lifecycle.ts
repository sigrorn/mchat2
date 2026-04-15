// ------------------------------------------------------------------
// Component: Lifecycle
// Responsibility: App-level lifecycle hooks: runtime detection, shutdown
//                 signals, window events. Used by stores to flush state
//                 on close and by adapters to decide real-vs-mock mode.
// Collaborators: stores/*, providers/registry.ts (mock in Node).
// ------------------------------------------------------------------

export interface LifecycleImpl {
  isTauri(): boolean;
  onBeforeUnload(handler: () => void | Promise<void>): () => void;
}

const defaultImpl: LifecycleImpl = {
  // Tauri injects __TAURI_INTERNALS__ into the webview global. Checking
  // this avoids importing @tauri-apps/api just for detection — so
  // browser/test contexts stay clean.
  isTauri() {
    return typeof globalThis !== "undefined" && "__TAURI_INTERNALS__" in globalThis;
  },
  onBeforeUnload(handler) {
    if (typeof window === "undefined") return () => {};
    const wrapped = (): void => {
      void handler();
    };
    window.addEventListener("beforeunload", wrapped);
    return () => window.removeEventListener("beforeunload", wrapped);
  },
};

let impl: LifecycleImpl = defaultImpl;

export const lifecycle = {
  isTauri: () => impl.isTauri(),
  onBeforeUnload: (h: () => void | Promise<void>) => impl.onBeforeUnload(h),
};

export function __setImpl(mock: LifecycleImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = defaultImpl;
}
