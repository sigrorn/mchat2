// ------------------------------------------------------------------
// Component: Typed settings accessors
// Responsibility: Thin typed layer over the flat string KV in
//                 persistence/settings. One defineNumberSetting call
//                 per key centralizes parse + validate + default so
//                 consumers don't re-implement the same
//                 parseInt/bounds/fallback pattern (#126).
// Collaborators: persistence/settings.ts, hooks/runOneTarget.ts,
//                lib/conversations/runCompaction.ts.
// ------------------------------------------------------------------

import { getSetting, setSetting } from "../persistence/settings";

export interface NumberSettingOptions {
  /** Value returned when the stored string is missing/blank/invalid/out-of-range. */
  default: number;
  /** Minimum accepted integer value (inclusive). */
  min: number;
}

export interface TypedNumberSetting {
  get(): Promise<number>;
  set(value: number): Promise<void>;
}

/**
 * Define a typed integer setting. Storage remains string in the flat
 * settings KV; the wrapper handles coercion and validation in one place.
 */
export function defineNumberSetting(
  key: string,
  opts: NumberSettingOptions,
): TypedNumberSetting {
  return {
    async get() {
      const raw = await getSetting(key);
      if (raw === null || raw === "") return opts.default;
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n < opts.min) return opts.default;
      return n;
    },
    async set(value) {
      if (!Number.isInteger(value)) {
        throw new Error(`setting ${key}: value must be an integer, got ${value}`);
      }
      if (value < opts.min) {
        throw new Error(`setting ${key}: value ${value} is below min ${opts.min}`);
      }
      await setSetting(key, String(value));
    },
  };
}
