// ------------------------------------------------------------------
// Component: SettingsGeneralDialog
// Responsibility: Editor for app-wide preferences. Currently a single
//                 textarea: the global system prompt that is prepended
//                 to every send (#23).
// Collaborators: persistence/settings.ts, settings/keys.ts.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import { getSetting, setSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY } from "@/lib/settings/keys";

export function SettingsGeneralDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const v = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);
      setValue(v ?? "");
      setLoading(false);
    })().catch((e) => setError((e as Error).message));
  }, []);

  const save = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      await setSetting(GLOBAL_SYSTEM_PROMPT_KEY, value);
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
          Prepended to every send, above the persona / conversation system prompt.
          Leave empty to disable.
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={loading}
          rows={10}
          placeholder="e.g. Be concise. Push back if my premise looks wrong."
          className="block w-full resize-y rounded border border-neutral-300 px-2 py-1.5 text-sm font-mono"
        />
        <p className="mt-4 text-xs text-neutral-500">
          Per-persona trace files (old-mchat <code className="font-mono">-debug</code>) are
          gated by the <code className="font-mono">MCHAT2_DEBUG=1</code> environment
          variable, set before launch — not a persisted setting, so a forgotten toggle
          can't quietly fill your disk.
        </p>
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
            <span className="text-xs text-neutral-500">Saved at {new Date(savedAt).toLocaleTimeString()}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
