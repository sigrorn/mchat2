// ------------------------------------------------------------------
// Component: SettingsOpenaiCompatTab
// Responsibility: The "OpenAI-compatible providers" tab content of
//                 the Settings · Providers dialog (#170). Owns:
//                   - the combobox listing built-in presets, customs,
//                     and "+ Add custom…"
//                   - the per-preset form (per the locked spec on
//                     #140: API key + per-preset extras like
//                     templateVars / extraHeaders / Custom URL)
//                   - the OK / Apply / Cancel / Delete button row
//                 Loads state from openaiCompatStorage on mount;
//                 Apply / OK persist to settings + keychain. Cancel
//                 discards only unsaved edits to the current entry.
// Collaborators: openaiCompatPresets, openaiCompatStorage, tauri/shell.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  BUILTIN_OPENAI_COMPAT_PRESETS,
  builtinPresetById,
} from "@/lib/providers/openaiCompatPresets";
import {
  loadOpenAICompatConfig,
  setBuiltinPresetConfig,
  upsertCustomPreset,
  removeCustomPreset,
  renameCustomPreset,
  getApiKeyForPreset,
  setApiKeyForPreset,
  removeApiKeyForPreset,
  type PresetRef,
} from "@/lib/providers/openaiCompatStorage";
import { formatHostingTag } from "@/lib/providers/derived";
import { shell } from "@/lib/tauri/shell";
import type {
  BuiltinPresetConfig,
  CustomPresetConfig,
} from "@/lib/schemas/openaiCompatConfig";

interface ComboEntry {
  ref: PresetRef | null; // null = "+ Add custom…"
  label: string;
  isBuiltin: boolean;
  isAddCustom: boolean;
}

interface FormDraft {
  // Field values currently shown in the form. Apply commits to
  // storage; Cancel discards back to the lastApplied snapshot.
  apiKey: string;
  // Built-in only:
  templateVars: Record<string, string>;
  extraHeaders: Record<string, string>;
  // Custom only:
  name: string;
  baseUrl: string;
  requiresKey: boolean;
  supportsUsageStream: boolean;
  customHeaderRows: { name: string; value: string }[];
}

const EMPTY_DRAFT: FormDraft = {
  apiKey: "",
  templateVars: {},
  extraHeaders: {},
  name: "",
  baseUrl: "",
  requiresKey: true,
  supportsUsageStream: true,
  customHeaderRows: [],
};

export function SettingsOpenaiCompatTab({ onClose }: { onClose: () => void }): JSX.Element {
  const [customs, setCustoms] = useState<CustomPresetConfig[]>([]);
  const [builtinSaved, setBuiltinSaved] = useState<Record<string, BuiltinPresetConfig>>({});
  const [selected, setSelected] = useState<ComboEntry | null>(null);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // The custom entry's name at the time it was last selected — kept
  // separately from `draft.name` so renames can be detected on Apply.
  const [originalCustomName, setOriginalCustomName] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const cfg = await loadOpenAICompatConfig();
      setCustoms(cfg.customs);
      setBuiltinSaved(cfg.builtins);
      // Default selection: first built-in.
      const first = BUILTIN_OPENAI_COMPAT_PRESETS[0];
      if (first) {
        const ref: PresetRef = { kind: "builtin", id: first.id };
        await selectEntry({ ref, label: first.displayName, isBuiltin: true, isAddCustom: false });
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectEntry(entry: ComboEntry): Promise<void> {
    setError(null);
    if (entry.isAddCustom) {
      setSelected(entry);
      setDraft({ ...EMPTY_DRAFT });
      setOriginalCustomName(null);
      return;
    }
    if (!entry.ref) return;
    if (entry.ref.kind === "builtin") {
      const def = builtinPresetById(entry.ref.id);
      if (!def) return;
      const saved = builtinSaved[entry.ref.id];
      const apiKey = (await getApiKeyForPreset(entry.ref)) ?? "";
      setSelected(entry);
      setDraft({
        apiKey,
        templateVars: { ...(saved?.templateVars ?? {}) },
        extraHeaders: { ...(saved?.extraHeaders ?? {}) },
        name: "",
        baseUrl: "",
        requiresKey: true,
        supportsUsageStream: true,
        customHeaderRows: [],
      });
      setOriginalCustomName(null);
      return;
    }
    // Custom — narrow ref to the custom variant.
    if (entry.ref.kind !== "custom") return;
    const ref = entry.ref;
    const cfg = customs.find((c) => c.name === ref.name);
    if (!cfg) return;
    const apiKey = (await getApiKeyForPreset(ref)) ?? "";
    setSelected(entry);
    setDraft({
      apiKey,
      templateVars: {},
      extraHeaders: {},
      name: cfg.name,
      baseUrl: cfg.baseUrl,
      requiresKey: cfg.requiresKey,
      supportsUsageStream: cfg.supportsUsageStream,
      customHeaderRows: Object.entries(cfg.extraHeaders).map(([name, value]) => ({ name, value })),
    });
    setOriginalCustomName(cfg.name);
  }

  async function applyDraft(): Promise<void> {
    setError(null);
    if (!selected) return;
    try {
      if (selected.isAddCustom || (selected.ref?.kind === "custom")) {
        // Custom save / add
        if (!draft.name.trim()) throw new Error("Name is required for a custom preset");
        if (!draft.baseUrl.trim()) throw new Error("Base URL is required for a custom preset");
        const headers: Record<string, string> = {};
        for (const row of draft.customHeaderRows) {
          if (row.name.trim() && row.value.trim()) headers[row.name.trim()] = row.value.trim();
        }
        const newName = draft.name.trim();
        if (selected.isAddCustom) {
          if (customs.some((c) => c.name === newName)) {
            throw new Error(`A custom preset named '${newName}' already exists`);
          }
          await upsertCustomPreset({
            name: newName,
            baseUrl: draft.baseUrl.trim(),
            extraHeaders: headers,
            requiresKey: draft.requiresKey,
            supportsUsageStream: draft.supportsUsageStream,
          });
        } else if (originalCustomName && originalCustomName !== newName) {
          await renameCustomPreset(originalCustomName, newName);
          await upsertCustomPreset({
            name: newName,
            baseUrl: draft.baseUrl.trim(),
            extraHeaders: headers,
            requiresKey: draft.requiresKey,
            supportsUsageStream: draft.supportsUsageStream,
          });
        } else {
          await upsertCustomPreset({
            name: newName,
            baseUrl: draft.baseUrl.trim(),
            extraHeaders: headers,
            requiresKey: draft.requiresKey,
            supportsUsageStream: draft.supportsUsageStream,
          });
        }
        // Save (or clear) API key.
        if (draft.apiKey.trim()) {
          await setApiKeyForPreset({ kind: "custom", name: newName }, draft.apiKey.trim());
        } else {
          await removeApiKeyForPreset({ kind: "custom", name: newName });
        }
        // Refresh local state and reselect the (possibly new-named) entry.
        const cfg = await loadOpenAICompatConfig();
        setCustoms(cfg.customs);
        const ref: PresetRef = { kind: "custom", name: newName };
        await selectEntry({ ref, label: newName, isBuiltin: false, isAddCustom: false });
      } else if (selected.ref?.kind === "builtin") {
        await setBuiltinPresetConfig(selected.ref.id, {
          templateVars: draft.templateVars,
          extraHeaders: draft.extraHeaders,
        });
        if (draft.apiKey.trim()) {
          await setApiKeyForPreset(selected.ref, draft.apiKey.trim());
        } else {
          await removeApiKeyForPreset(selected.ref);
        }
        const cfg = await loadOpenAICompatConfig();
        setBuiltinSaved(cfg.builtins);
      }
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteCurrent(): Promise<void> {
    if (!selected || selected.ref?.kind !== "custom") return;
    setError(null);
    try {
      await removeCustomPreset(selected.ref.name);
      const cfg = await loadOpenAICompatConfig();
      setCustoms(cfg.customs);
      const first = BUILTIN_OPENAI_COMPAT_PRESETS[0];
      if (first) {
        await selectEntry({
          ref: { kind: "builtin", id: first.id },
          label: first.displayName,
          isBuiltin: true,
          isAddCustom: false,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function onComboChange(value: string): void {
    if (value === "__add_custom__") {
      void selectEntry({ ref: null, label: "+ Add custom…", isBuiltin: false, isAddCustom: true });
      return;
    }
    if (value.startsWith("builtin:")) {
      const id = value.slice("builtin:".length);
      const def = builtinPresetById(id);
      if (!def) return;
      void selectEntry({
        ref: { kind: "builtin", id },
        label: def.displayName,
        isBuiltin: true,
        isAddCustom: false,
      });
      return;
    }
    if (value.startsWith("custom:")) {
      const name = value.slice("custom:".length);
      void selectEntry({
        ref: { kind: "custom", name },
        label: name,
        isBuiltin: false,
        isAddCustom: false,
      });
    }
  }

  if (loading) return <div className="text-sm text-neutral-500">Loading…</div>;

  const def =
    selected?.ref?.kind === "builtin" ? builtinPresetById(selected.ref.id) : null;
  const showRegisterLink =
    def && !draft.apiKey.trim() && def.registrationUrl;

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-700">Provider</label>
        <select
          aria-label="Provider"
          value={
            selected?.isAddCustom
              ? "__add_custom__"
              : selected?.ref?.kind === "builtin"
                ? `builtin:${selected.ref.id}`
                : selected?.ref?.kind === "custom"
                  ? `custom:${selected.ref.name}`
                  : ""
          }
          onChange={(e) => onComboChange(e.target.value)}
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        >
          {BUILTIN_OPENAI_COMPAT_PRESETS.map((p) => {
            const tag = formatHostingTag(p.hostingCountry);
            return (
              <option key={p.id} value={`builtin:${p.id}`}>
                {tag ? `${tag} ${p.displayName}` : p.displayName}
              </option>
            );
          })}
          {customs.length > 0 ? <option disabled>──────────────</option> : null}
          {customs.map((c) => (
            <option key={c.name} value={`custom:${c.name}`}>
              {c.name}
            </option>
          ))}
          <option disabled>──────────────</option>
          <option value="__add_custom__">+ Add custom…</option>
        </select>
      </div>

      {/* Form area changes per selected preset. */}
      {selected?.ref?.kind === "builtin" && def ? (
        <BuiltinForm
          def={def}
          draft={draft}
          onDraft={setDraft}
        />
      ) : null}
      {(selected?.isAddCustom || selected?.ref?.kind === "custom") ? (
        <CustomForm draft={draft} onDraft={setDraft} />
      ) : null}

      {/* Register link (built-ins only, when no key configured). */}
      {showRegisterLink ? (
        <div className="text-xs text-neutral-600">
          No API key configured. {" "}
          <button
            type="button"
            onClick={() => void shell.open(def.registrationUrl)}
            className="text-blue-700 underline hover:text-blue-900"
          >
            Register at {def.displayName} →
          </button>
        </div>
      ) : null}
      {selected?.isAddCustom || selected?.ref?.kind === "custom" ? (
        !draft.apiKey.trim() ? (
          <div className="text-xs text-neutral-500 italic">
            No API key configured.
          </div>
        ) : null
      ) : null}

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {savedAt ? (
        <div className="text-xs text-green-700">
          Saved at {new Date(savedAt).toLocaleTimeString()}.
        </div>
      ) : null}

      <div className="flex justify-between gap-2 pt-2">
        <div>
          {selected?.ref?.kind === "custom" ? (
            <button
              onClick={() => void deleteCurrent()}
              className="rounded border border-red-600 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            onClick={() => void applyDraft()}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Apply
          </button>
          <button
            onClick={async () => {
              await applyDraft();
              onClose();
            }}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function BuiltinForm({
  def,
  draft,
  onDraft,
}: {
  def: ReturnType<typeof builtinPresetById> & object;
  draft: FormDraft;
  onDraft: (next: FormDraft) => void;
}): JSX.Element {
  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-700">API Key</label>
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => onDraft({ ...draft, apiKey: e.target.value })}
          placeholder={`openai_compat.${def.id}.apiKey`}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm"
        />
      </div>
      {def.templateVars.map((name) => (
        <div key={name}>
          <label className="mb-1 block text-xs font-medium text-neutral-700">{name}</label>
          <input
            aria-label={name}
            value={draft.templateVars[name] ?? ""}
            onChange={(e) =>
              onDraft({
                ...draft,
                templateVars: { ...draft.templateVars, [name]: e.target.value },
              })
            }
            placeholder={`e.g. abc123`}
            className="w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm"
          />
        </div>
      ))}
      {def.optionalHeaders.map((name) => (
        <div key={name}>
          <label className="mb-1 block text-xs font-medium text-neutral-700">
            {name} <span className="text-neutral-400">(optional)</span>
          </label>
          <input
            value={draft.extraHeaders[name] ?? ""}
            onChange={(e) =>
              onDraft({
                ...draft,
                extraHeaders: { ...draft.extraHeaders, [name]: e.target.value },
              })
            }
            placeholder={
              name === "HTTP-Referer"
                ? "https://your-app.example"
                : name === "X-Title"
                  ? "Your app's display name"
                  : ""
            }
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
      ))}
    </>
  );
}

function CustomForm({
  draft,
  onDraft,
}: {
  draft: FormDraft;
  onDraft: (next: FormDraft) => void;
}): JSX.Element {
  const setHeaderRow = (idx: number, patch: Partial<{ name: string; value: string }>): void => {
    const next = [...draft.customHeaderRows];
    next[idx] = { ...next[idx]!, ...patch };
    onDraft({ ...draft, customHeaderRows: next });
  };
  const addHeaderRow = (): void => {
    onDraft({
      ...draft,
      customHeaderRows: [...draft.customHeaderRows, { name: "", value: "" }],
    });
  };
  const removeHeaderRow = (idx: number): void => {
    onDraft({
      ...draft,
      customHeaderRows: draft.customHeaderRows.filter((_, i) => i !== idx),
    });
  };
  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-700">Name</label>
        <input
          value={draft.name}
          onChange={(e) => onDraft({ ...draft, name: e.target.value })}
          placeholder="my-vllm-server"
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-700">Base URL</label>
        <input
          value={draft.baseUrl}
          onChange={(e) => onDraft({ ...draft, baseUrl: e.target.value })}
          placeholder="http://localhost:8000/v1/chat/completions"
          className="w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-700">API Key</label>
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => onDraft({ ...draft, apiKey: e.target.value })}
          placeholder="(leave empty if your endpoint requires no auth)"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm"
        />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={draft.requiresKey}
            onChange={(e) => onDraft({ ...draft, requiresKey: e.target.checked })}
          />
          Requires API key
        </label>
        <label className="flex items-center gap-1 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={draft.supportsUsageStream}
            onChange={(e) => onDraft({ ...draft, supportsUsageStream: e.target.checked })}
          />
          Supports stream_options.include_usage
        </label>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-700">Extra headers</span>
          <button
            type="button"
            onClick={addHeaderRow}
            className="text-xs text-blue-700 hover:underline"
          >
            + Add header
          </button>
        </div>
        {draft.customHeaderRows.length === 0 ? (
          <div className="text-xs text-neutral-400 italic">(none)</div>
        ) : (
          <div className="space-y-1">
            {draft.customHeaderRows.map((row, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  value={row.name}
                  onChange={(e) => setHeaderRow(idx, { name: e.target.value })}
                  placeholder="Header-Name"
                  className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
                <input
                  value={row.value}
                  onChange={(e) => setHeaderRow(idx, { value: e.target.value })}
                  placeholder="value"
                  className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeHeaderRow(idx)}
                  className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
