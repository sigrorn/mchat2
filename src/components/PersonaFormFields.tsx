// ------------------------------------------------------------------
// Component: PersonaFormFields
// Responsibility: Shared form fields between the Edit (PersonaRow)
//                 and Create (CreateForm) flows in PersonaPanel.tsx
//                 (#139). Renders Name, Provider, Model + datalist,
//                 Color override, Visibility grids, System prompt.
//                 Parents own state; this child takes value/onChange
//                 callbacks per field. Differences between Edit and
//                 Create are captured by the optional self / variant
//                 props rather than two near-duplicate copies.
// Collaborators: PersonaPanel.tsx (sole consumer), useModelOptions.
// ------------------------------------------------------------------

import type { Persona, ProviderId } from "@/lib/types";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { PROVIDER_COLORS, formatHostingTag } from "@/lib/providers/derived";
import { userSelectableProviderIds } from "@/lib/providers/userSelectable";
import { formatTokenLimit, type ModelInfo } from "@/lib/providers/models";
import {
  applyVisibilityPreset,
  type VisibilityRole,
} from "@/lib/personas/visibilityPresets";
import { useOpenAICompatPresets } from "./useOpenAICompatPresets";
import { OutlineButton } from "@/components/ui/Button";

// Native providers, minus the openai_compat meta-provider — that one
// is fanned out into per-preset entries below.
const SELECTABLE_PROVIDER_IDS = userSelectableProviderIds(import.meta.env.DEV).filter(
  (id) => id !== "openai_compat",
);

export interface PersonaFormFieldsProps {
  // Field values + setters owned by the parent.
  name: string;
  onNameChange: (v: string) => void;
  provider: ProviderId;
  onProviderChange: (v: ProviderId) => void;
  model: string;
  onModelChange: (v: string) => void;
  prompt: string;
  onPromptChange: (v: string) => void;
  colorOverride: string | null;
  onColorOverrideChange: (v: string | null) => void;
  visDefs: Record<string, "y" | "n">;
  onVisDefsChange: (v: Record<string, "y" | "n">) => void;
  seenByEdits: Record<string, "y" | "n">;
  onSeenByEditsChange: (v: Record<string, "y" | "n">) => void;
  // #171: when provider === "openai_compat", which preset the persona
  // resolves to. Null otherwise. Parent owns persistence; this child
  // just fires the callback when the dropdown selection switches.
  openaiCompatPreset?: Persona["openaiCompatPreset"];
  onOpenaiCompatPresetChange?: (v: Persona["openaiCompatPreset"]) => void;

  // Personas to show in the visibility grids (already filtered to
  // exclude self in the Edit case, the full list in the Create case).
  siblings: readonly Persona[];

  // The persona being edited, or null when creating a new one. Drives
  // the "Responses seen by" baseline lookup: in Edit, baseline is the
  // current value of `other.visibilityDefaults[self.nameSlug]`; in
  // Create, the persona doesn't exist yet so the baseline defaults to
  // "y" (visible).
  self: Persona | null;

  // Datalist id (must be unique across mounted instances; CreateForm
  // uses a fixed string, PersonaRow uses persona-id-derived).
  modelListId: string;
  modelOptions: readonly ModelInfo[];

  // Edit and Create differ on Name input chrome and System prompt
  // ergonomics. Defaults match the Edit flow.
  nameAutoFocus?: boolean;
  namePlaceholder?: string;
  promptPlaceholder?: string;
  promptRows?: number;
}

export function PersonaFormFields(props: PersonaFormFieldsProps): JSX.Element {
  const {
    name,
    onNameChange,
    provider,
    onProviderChange,
    model,
    onModelChange,
    prompt,
    onPromptChange,
    colorOverride,
    onColorOverrideChange,
    visDefs,
    onVisDefsChange,
    seenByEdits,
    onSeenByEditsChange,
    siblings,
    self,
    modelListId,
    modelOptions,
    nameAutoFocus = false,
    namePlaceholder,
    promptPlaceholder,
    promptRows = 3,
    openaiCompatPreset,
    onOpenaiCompatPresetChange,
  } = props;

  const openaiCompatPresets = useOpenAICompatPresets();

  // The dropdown's value space is unified: native provider ids plus
  // `openai_compat:builtin:<id>` and `openai_compat:custom:<name>`
  // for each configurable preset.
  const dropdownValue =
    provider === "openai_compat" && openaiCompatPreset
      ? openaiCompatPreset.kind === "builtin"
        ? `openai_compat:builtin:${openaiCompatPreset.id}`
        : `openai_compat:custom:${openaiCompatPreset.name}`
      : provider;

  const onProviderSelect = (value: string): void => {
    if (value.startsWith("openai_compat:builtin:")) {
      onProviderChange("openai_compat");
      onOpenaiCompatPresetChange?.({
        kind: "builtin",
        id: value.slice("openai_compat:builtin:".length),
      });
      onModelChange("");
      return;
    }
    if (value.startsWith("openai_compat:custom:")) {
      onProviderChange("openai_compat");
      onOpenaiCompatPresetChange?.({
        kind: "custom",
        name: value.slice("openai_compat:custom:".length),
      });
      onModelChange("");
      return;
    }
    onProviderChange(value as ProviderId);
    onOpenaiCompatPresetChange?.(null);
    onModelChange("");
  };

  // Hosting tag for the model picker — for openai_compat we look up
  // the preset's country, not the (placeholder) registry entry.
  const hostingCountryForTag =
    provider === "openai_compat" && openaiCompatPreset
      ? openaiCompatPresets.find(
          (p) =>
            p.ref.kind === openaiCompatPreset.kind &&
            (p.ref.kind === "builtin"
              ? p.ref.id === (openaiCompatPreset as { kind: "builtin"; id: string }).id
              : p.ref.name === (openaiCompatPreset as { kind: "custom"; name: string }).name),
        )?.hostingCountry ?? null
      : PROVIDER_REGISTRY[provider].hostingCountry;
  const hostingTag = formatHostingTag(hostingCountryForTag);

  return (
    <>
      <Field label="Name">
        <input
          aria-label="Name"
          {...(nameAutoFocus ? { autoFocus: true } : {})}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          {...(namePlaceholder ? { placeholder: namePlaceholder } : {})}
          className="w-full rounded border border-neutral-300 px-2 py-1"
        />
      </Field>
      <Field label="Provider">
        <select
          value={dropdownValue}
          onChange={(e) => onProviderSelect(e.target.value)}
          className="w-full rounded border border-neutral-300 px-2 py-1"
        >
          {SELECTABLE_PROVIDER_IDS.map((id) => {
            const tag = formatHostingTag(PROVIDER_REGISTRY[id].hostingCountry);
            return (
              <option key={id} value={id}>
                {tag ? `${tag} ${PROVIDER_REGISTRY[id].displayName}` : PROVIDER_REGISTRY[id].displayName}
              </option>
            );
          })}
          {openaiCompatPresets.length > 0 ? (
            <option disabled>──────────────</option>
          ) : null}
          {openaiCompatPresets.map((p) => {
            const value =
              p.ref.kind === "builtin"
                ? `openai_compat:builtin:${p.ref.id}`
                : `openai_compat:custom:${p.ref.name}`;
            const tag = formatHostingTag(p.hostingCountry);
            const label = tag ? `${tag} ${p.displayName}` : p.displayName;
            return (
              <option
                key={value}
                value={value}
                disabled={!p.configured}
                title={
                  p.configured
                    ? undefined
                    : "Not yet configured — open Settings · Providers to set the API key"
                }
              >
                {p.configured ? label : `${label} (not configured)`}
              </option>
            );
          })}
        </select>
      </Field>
      <Field label="Model override">
        <input
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          list={modelListId}
          placeholder={PROVIDER_REGISTRY[provider].defaultModel}
          className="w-full rounded border border-neutral-300 px-2 py-1"
        />
        <datalist id={modelListId}>
          {modelOptions.map((m) => {
            const tokens = m.maxTokens ? ` — ${formatTokenLimit(m.maxTokens)}` : "";
            return (
              <option key={m.id} value={m.id}>
                {hostingTag ? `${hostingTag} ${m.id}${tokens}` : `${m.id}${tokens}`}
              </option>
            );
          })}
        </datalist>
      </Field>
      <Field label="Color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={colorOverride ?? PROVIDER_COLORS[provider]}
            onChange={(e) => onColorOverrideChange(e.target.value)}
            className="h-6 w-8 cursor-pointer rounded border border-neutral-300 p-0"
          />
          <span className="text-neutral-500">
            {colorOverride ? "custom" : "provider default"}
          </span>
          {colorOverride !== null && (
            <button
              type="button"
              onClick={() => onColorOverrideChange(null)}
              className="text-neutral-500 hover:text-neutral-900"
            >
              reset
            </button>
          )}
        </div>
      </Field>
      {siblings.length > 0 && (
        <Field label="Visibility">
          <div className="space-y-2">
            {/* #173: shortcut presets that bulk-set the checkboxes
                below. Pure form-state edits — no auto-save. The user
                can fine-tune individual cells afterwards. */}
            <div className="flex flex-wrap gap-1">
              <PresetButton
                role="speaker"
                siblings={siblings}
                onApply={(r) => {
                  onVisDefsChange(r.visDefs);
                  onSeenByEditsChange(r.seenByEdits);
                }}
              >
                Speaker
              </PresetButton>
              <PresetButton
                role="participant"
                siblings={siblings}
                onApply={(r) => {
                  onVisDefsChange(r.visDefs);
                  onSeenByEditsChange(r.seenByEdits);
                }}
              >
                Participant
              </PresetButton>
              <PresetButton
                role="observer"
                siblings={siblings}
                onApply={(r) => {
                  onVisDefsChange(r.visDefs);
                  onSeenByEditsChange(r.seenByEdits);
                }}
              >
                Observer
              </PresetButton>
            </div>
            <div>
              <span className="text-neutral-500">Can see responses from:</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {siblings.map((other) => {
                  const checked = (visDefs[other.nameSlug] ?? "y") === "y";
                  return (
                    <label key={other.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          onVisDefsChange({
                            ...visDefs,
                            [other.nameSlug]: checked ? "n" : "y",
                          })
                        }
                      />
                      <span className="text-neutral-800">{other.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="text-neutral-500">Responses seen by:</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {siblings.map((other) => {
                  // In Edit, the baseline reflects current state. In
                  // Create, the new persona's slug isn't on any other
                  // yet — start from "y".
                  const seenByBase = self
                    ? (other.visibilityDefaults[self.nameSlug] ?? "y")
                    : "y";
                  const seenByVal =
                    other.nameSlug in seenByEdits
                      ? (seenByEdits[other.nameSlug] ?? "y")
                      : seenByBase;
                  const checked = seenByVal === "y";
                  return (
                    <label key={other.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          onSeenByEditsChange({
                            ...seenByEdits,
                            [other.nameSlug]: checked ? "n" : "y",
                          })
                        }
                      />
                      <span className="text-neutral-800">{other.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </Field>
      )}
      <Field label="System prompt">
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={promptRows}
          {...(promptPlaceholder ? { placeholder: promptPlaceholder } : {})}
          className="w-full rounded border border-neutral-300 px-2 py-1 font-mono"
        />
      </Field>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-neutral-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PresetButton({
  role,
  siblings,
  onApply,
  children,
}: {
  role: VisibilityRole;
  siblings: readonly Persona[];
  onApply: (r: ReturnType<typeof applyVisibilityPreset>) => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <OutlineButton
      onClick={() => onApply(applyVisibilityPreset(role, siblings))}
      size="xs"
      title={
        role === "speaker"
          ? "Sees no other persona's replies; everyone hears this one."
          : role === "participant"
            ? "Sees everyone, seen by everyone (default)."
            : "Sees everyone, contributes invisibly."
      }
    >
      {children}
    </OutlineButton>
  );
}
