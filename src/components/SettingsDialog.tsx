// ------------------------------------------------------------------
// Component: SettingsDialog (Settings · Providers)
// Responsibility: Two-tabbed dialog (#170) for configuring provider
//                 access. Tab 1 is the legacy per-provider API-key
//                 form (with new Register links per #140 spec) for
//                 the native providers. Tab 2 is the new OpenAI-
//                 compatible-provider config — implementation lives
//                 in SettingsOpenaiCompatTab.
// Collaborators: tauri/keychain, providers/registry, tauri/shell
//                (Register links), SettingsOpenaiCompatTab.
// ------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "./focusTrap";
import { ALL_PROVIDER_IDS, PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { keychain } from "@/lib/tauri/keychain";
import { getSetting, setSetting } from "@/lib/persistence/settings";
import { APERTUS_PRODUCT_ID_KEY } from "@/lib/settings/keys";
import { shell } from "@/lib/tauri/shell";
import { SettingsOpenaiCompatTab } from "./SettingsOpenaiCompatTab";

// Module-scope so the useEffect dependency is a stable reference.
const KEY_PROVIDERS = ALL_PROVIDER_IDS.filter(
  (id) => PROVIDER_REGISTRY[id].requiresKey && id !== "openai_compat",
);

// Native-provider sign-up URLs — surfaced as a "Register" link next
// to each provider whose API key is unset (#140 spec). Keep this
// table close to the dialog that uses it; the openai-compat presets
// own their own registrationUrl on the preset definition.
const NATIVE_REGISTRATION_URLS: Record<string, string> = {
  claude: "https://console.anthropic.com/",
  openai: "https://platform.openai.com/signup",
  gemini: "https://aistudio.google.com/apikey",
  perplexity: "https://www.perplexity.ai/settings/api",
  mistral: "https://console.mistral.ai/",
  apertus: "https://manager.infomaniak.com/",
};

type Tab = "standard" | "openai_compat";

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>("standard");

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, onClose);

  return (
    <div
      role="dialog"
      aria-label="Providers"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="w-[36rem] max-w-full rounded bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-semibold">Providers</h2>
        <div className="mb-4 flex border-b border-neutral-200">
          <TabButton active={tab === "standard"} onClick={() => setTab("standard")}>
            Standard providers
          </TabButton>
          <TabButton active={tab === "openai_compat"} onClick={() => setTab("openai_compat")}>
            OpenAI-compatible providers
          </TabButton>
        </div>
        {tab === "standard" ? (
          <StandardProvidersTab onClose={onClose} />
        ) : (
          <SettingsOpenaiCompatTab onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
        active
          ? "border-neutral-900 text-neutral-900"
          : "border-transparent text-neutral-500 hover:text-neutral-900"
      }`}
    >
      {children}
    </button>
  );
}

function StandardProvidersTab({ onClose }: { onClose: () => void }): JSX.Element {
  const providers = KEY_PROVIDERS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apertusProductId, setApertusProductId] = useState("");
  const [saving, setSaving] = useState(false);

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
    <>
      <p className="mb-4 text-xs text-neutral-500">
        Stored in the OS-native keychain. Never sent anywhere except the provider you entered them
        for.
      </p>
      {loading ? (
        <div className="text-sm text-neutral-500">Loading…</div>
      ) : (
        <div className="space-y-3">
          {providers.map((id) => {
            const meta = PROVIDER_REGISTRY[id];
            const shown = reveal[id] ?? false;
            const hasKey = (values[id] ?? "").trim().length > 0;
            const regUrl = NATIVE_REGISTRATION_URLS[id];
            return (
              <div key={id}>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="text-xs font-medium text-neutral-700">{meta.displayName}</label>
                  {!hasKey && regUrl ? (
                    <button
                      type="button"
                      onClick={() => void shell.open(regUrl)}
                      className="text-[11px] text-blue-700 underline hover:text-blue-900"
                    >
                      Register at {meta.displayName} →
                    </button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <input
                    type={shown ? "text" : "password"}
                    value={values[id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
                    placeholder={`${meta.keychainKey}`}
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm"
                  />
                  <button
                    onClick={() => setReveal((r) => ({ ...r, [id]: !shown }))}
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
    </>
  );
}
