// ------------------------------------------------------------------
// Component: SettingsDialog
// Responsibility: Per-provider API key editor backed by the keychain.
//                 Keys are read on open, written on save, and never
//                 held in reactive state beyond this component.
// Collaborators: tauri/keychain.ts, providers/registry.ts.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import { ALL_PROVIDER_IDS, PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { keychain } from "@/lib/tauri/keychain";
import { getSetting, setSetting } from "@/lib/persistence/settings";
import { APERTUS_PRODUCT_ID_KEY } from "@/lib/settings/keys";

// Module-scope so the useEffect dependency is a stable reference —
// otherwise every keystroke re-derives the array and re-runs the
// keychain-reload effect, wiping whatever the user just typed.
const KEY_PROVIDERS = ALL_PROVIDER_IDS.filter((id) => PROVIDER_REGISTRY[id].requiresKey);

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const providers = KEY_PROVIDERS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const v: Record<string, string> = {};
      for (const id of providers) {
        const stored = await keychain.get(PROVIDER_REGISTRY[id].keychainKey);
        v[id] = stored ?? "";
      }
      setValues(v);
      const pid = await getSetting(APERTUS_PRODUCT_ID_KEY);
      setApertusProductId(pid ?? "");
      setLoading(false);
    })().catch((e) => setError((e as Error).message));
  }, [providers]);

  const [apertusProductId, setApertusProductId] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      for (const id of providers) {
        const key = PROVIDER_REGISTRY[id].keychainKey;
        const val = values[id]?.trim() ?? "";
        if (val) {
          await keychain.set(key, val);
        } else {
          // Only attempt removal if we actually have a stored value —
          // Some backends throw on remove of a missing key.
          const existing = await keychain.get(key);
          if (existing) await keychain.remove(key);
        }
      }
      await setSetting(APERTUS_PRODUCT_ID_KEY, apertusProductId.trim());
      setSavedAt(Date.now());
    } catch (e) {
      console.error("keychain save failed", e);
      setError(`${(e as Error).name}: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[32rem] max-w-full rounded bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-semibold">API keys</h2>
        <p className="mb-4 text-xs text-neutral-500">
          Stored in the OS-native keychain. Never sent anywhere except
          the provider you entered them for.
        </p>
        {loading ? (
          <div className="text-sm text-neutral-500">Loading…</div>
        ) : (
          <div className="space-y-3">
            {providers.map((id) => {
              const meta = PROVIDER_REGISTRY[id];
              const shown = reveal[id] ?? false;
              return (
                <div key={id}>
                  <label className="mb-1 block text-xs font-medium text-neutral-700">
                    {meta.displayName}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={shown ? "text" : "password"}
                      value={values[id] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [id]: e.target.value }))
                      }
                      placeholder={`${meta.keychainKey}`}
                      autoComplete="off"
                      spellCheck={false}
                      className="flex-1 rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm"
                    />
                    <button
                      onClick={() =>
                        setReveal((r) => ({ ...r, [id]: !shown }))
                      }
                      className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
                    >
                      {shown ? "hide" : "show"}
                    </button>
                  </div>
                  {id === "apertus" ? (
                    <div className="mt-2">
                      <label className="mb-1 block text-xs text-neutral-600">
                        Product-Id (Infomaniak account)
                      </label>
                      <input
                        value={apertusProductId}
                        onChange={(e) => setApertusProductId(e.target.value)}
                        placeholder="e.g. 12345"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
        {savedAt ? (
          <div className="mt-3 text-xs text-green-700">
            Saved at {new Date(savedAt).toLocaleTimeString()}.
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Close
          </button>
          <button
            onClick={() => void save()}
            disabled={loading || saving}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
