// ------------------------------------------------------------------
// Component: UI store
// Responsibility: Small cross-cutting UI state that doesn't belong to
//                 a feature-specific store. Currently: font-zoom scale
//                 (#50). Persisted via the settings table — load on
//                 app start, save on change.
// Collaborators: App (load/keybindings), MessageList / Composer (read).
// ------------------------------------------------------------------

import { create } from "zustand";
import { DEFAULT_SCALE } from "@/lib/ui/fontScale";
import { getSetting, setSetting } from "@/lib/persistence/settings";

const FONT_SCALE_KEY = "ui.fontScale";

interface State {
  chatFontScale: number;
  loadFontScale: () => Promise<void>;
  setFontScale: (scale: number) => void;
}

export const useUiStore = create<State>((set) => ({
  chatFontScale: DEFAULT_SCALE,
  async loadFontScale() {
    const raw = await getSetting(FONT_SCALE_KEY);
    const n = raw ? Number(raw) : DEFAULT_SCALE;
    set({ chatFontScale: Number.isFinite(n) && n > 0 ? n : DEFAULT_SCALE });
  },
  setFontScale(scale) {
    set({ chatFontScale: scale });
    void setSetting(FONT_SCALE_KEY, String(scale));
  },
}));
