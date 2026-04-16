// ------------------------------------------------------------------
// Component: UI store
// Responsibility: Small cross-cutting UI state that doesn't belong to
//                 one feature store. Right now: a keychain-busy counter
//                 so the Composer can show an 'Unlocking...' hint on
//                 cold start (#32).
// Collaborators: tauri/keychain.ts (increments), components/Composer.
// ------------------------------------------------------------------

import { create } from "zustand";

interface State {
  keychainBusy: number;
}

export const useUiStore = create<State>(() => ({
  keychainBusy: 0,
}));
