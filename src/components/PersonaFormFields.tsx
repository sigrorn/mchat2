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

const SELECTABLE_PROVIDER_IDS = userSelectableProviderIds(import.meta.env.DEV);

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
  } = props;

  const hostingTag = formatHostingTag(PROVIDER_REGISTRY[provider].hostingCountry);

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
          value={provider}
          onChange={(e) => {
            onProviderChange(e.target.value as ProviderId);
            onModelChange("");
          }}
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
