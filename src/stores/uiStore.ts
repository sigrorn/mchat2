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
import { buildSessionTimestamp } from "@/lib/tracing/traceFilename";
import { getSetting, setSetting } from "@/lib/persistence/settings";
import { GENERAL_WORKING_DIR_KEY } from "@/lib/settings/keys";

const FONT_SCALE_KEY = "ui.fontScale";
const STREAM_RESPONSES_KEY = "ui.streamResponses";

export interface FindState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  activeIndex: number;
}

// #46: per-launch debug trace session. Not persisted — starts OFF.
export interface DebugSession {
  enabled: boolean;
  sessionTimestamp: string | null;
}

interface State {
  chatFontScale: number;
  loadFontScale: () => Promise<void>;
  setFontScale: (scale: number) => void;
  workingDir: string | null;
  loadWorkingDir: () => Promise<void>;
  setWorkingDir: (dir: string) => Promise<void>;
  debugSession: DebugSession;
  toggleDebug: () => void;
  // #131: user-facing stream/buffer toggle for response display.
  // When false, tokens still accumulate but per-token UI patching is
  // suppressed — bubble stays empty until the reply completes.
  streamResponses: boolean;
  loadStreamResponses: () => Promise<void>;
  toggleStreamResponses: () => void;
  // #53: Ctrl+F find state. Not persisted — per-session only.
  find: FindState;
  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (query: string) => void;
  setFindCaseSensitive: (caseSensitive: boolean) => void;
  setFindActiveIndex: (activeIndex: number) => void;
}

const INITIAL_FIND: FindState = { open: false, query: "", caseSensitive: false, activeIndex: 0 };

export const useUiStore = create<State>((set, get) => ({
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
  workingDir: null,
  async loadWorkingDir() {
    const raw = await getSetting(GENERAL_WORKING_DIR_KEY);
    set({ workingDir: raw?.trim() || null });
  },
  async setWorkingDir(dir: string) {
    const trimmed = dir.trim();
    await setSetting(GENERAL_WORKING_DIR_KEY, trimmed);
    set({ workingDir: trimmed || null });
  },
  streamResponses: true,
  async loadStreamResponses() {
    const raw = await getSetting(STREAM_RESPONSES_KEY);
    // Default is true (stream). Any stored "false" opts into buffering.
    set({ streamResponses: raw === null ? true : raw !== "false" });
  },
  toggleStreamResponses() {
    const next = !get().streamResponses;
    set({ streamResponses: next });
    void setSetting(STREAM_RESPONSES_KEY, next ? "true" : "false");
  },
  debugSession: { enabled: false, sessionTimestamp: null },
  toggleDebug() {
    const prev = get().debugSession;
    if (prev.enabled) {
      set({ debugSession: { enabled: false, sessionTimestamp: null } });
    } else {
      set({
        debugSession: {
          enabled: true,
          sessionTimestamp: buildSessionTimestamp(new Date()),
        },
      });
    }
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
