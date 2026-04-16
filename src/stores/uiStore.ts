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

export interface FindState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  activeIndex: number;
}

interface State {
  chatFontScale: number;
  loadFontScale: () => Promise<void>;
  setFontScale: (scale: number) => void;
  // #53: Ctrl+F find state. Not persisted — per-session only.
  find: FindState;
  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (query: string) => void;
  setFindCaseSensitive: (caseSensitive: boolean) => void;
  setFindActiveIndex: (activeIndex: number) => void;
}

const INITIAL_FIND: FindState = { open: false, query: "", caseSensitive: false, activeIndex: 0 };

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
  find: INITIAL_FIND,
  openFind() {
    set((s) => ({ find: { ...s.find, open: true } }));
  },
  closeFind() {
    set({ find: INITIAL_FIND });
  },
  setFindQuery(query) {
    set((s) => ({ find: { ...s.find, query, activeIndex: 0 } }));
  },
  setFindCaseSensitive(caseSensitive) {
    set((s) => ({ find: { ...s.find, caseSensitive, activeIndex: 0 } }));
  },
  setFindActiveIndex(activeIndex) {
    set((s) => ({ find: { ...s.find, activeIndex } }));
  },
}));
