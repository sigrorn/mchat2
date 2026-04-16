// ------------------------------------------------------------------
// Component: SettingsGeneralDialog
// Responsibility: Editor for app-wide preferences. Currently a single
//                 textarea: the global system prompt that is prepended
//                 to every send (#23).
// Collaborators: persistence/settings.ts, settings/keys.ts.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import { getSetting, setSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY, GENERAL_WORKING_DIR_KEY } from "@/lib/settings/keys";
import { useUiStore } from "@/stores/uiStore";

export function SettingsGeneralDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [value, setValue] = useState("");
  const [workDir, setWorkDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const v = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);
      setValue(v ?? "");
      const wd = await getSetting(GENERAL_WORKING_DIR_KEY);
      setWorkDir(wd ?? "");
      setLoading(false);
    })().catch((e) => setError((e as Error).message));
  }, []);

  const save = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      await setSetting(GLOBAL_SYSTEM_PROMPT_KEY, value);
      await useUiStore.getState().setWorkingDir(workDir);
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="General settings"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">General settings</h2>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <label className="mb-1 block text-xs font-medium text-neutral-700">
          Global system prompt
        </label>
        <p className="mb-2 text-xs text-neutral-500">
          Prepended to every send, above the persona / conversation system prompt. Leave empty to
          disable.
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={loading}
          rows={10}
          placeholder="e.g. Be concise. Push back if my premise looks wrong."
          className="block w-full resize-y rounded border border-neutral-300 px-2 py-1.5 text-sm font-mono"
        />
        <label className="mt-4 mb-1 block text-xs font-medium text-neutral-700">
          Working directory
        </label>
        <p className="mb-2 text-xs text-neutral-500">
          Default location for import/export and debug trace files. Required before the Debug toggle
          is available.
        </p>
        <input
          value={workDir}
          onChange={(e) => setWorkDir(e.target.value)}
          disabled={loading}
          placeholder="e.g. C:\Users\me\Documents\mchat2"
          className="block w-full rounded border border-neutral-300 px-2 py-1.5 text-sm font-mono"
        />
        {error ? <div className="mt-2 text-sm text-red-700">{error}</div> : null}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saving || loading}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {savedAt ? (
            <span className="text-xs text-neutral-500">
              Saved at {new Date(savedAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
