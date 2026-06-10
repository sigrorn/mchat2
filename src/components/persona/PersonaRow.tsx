// ------------------------------------------------------------------
// Component: PersonaRow
// Responsibility: One persona in the list — selection checkbox, drag
//                 handle (dnd-kit), nav-scope click target, cost, and
//                 the inline edit/delete form. Extracted from
//                 PersonaPanel.tsx in #319.
// Collaborators: PersonaPanelExpanded (parent, owns onSave/onDelete),
//                PersonaFormFields, PersonaProviderLabel, sendStore.
// ------------------------------------------------------------------

import { useState } from "react";
import type { Persona, ProviderId } from "@/lib/types";
import type { CostResult } from "@/lib/pricing/estimator";
import { PROVIDER_COLORS } from "@/lib/providers/derived";
import { formatPersonaCost } from "@/lib/pricing/personaCosts";
import { PersonaValidationError } from "@/lib/personas/service";
import { useSendStore, type StreamStatus } from "@/stores/sendStore";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PrimaryButton, DangerButton } from "@/components/ui/Button";
import { useModelOptions, modelOptionsFromPricing } from "../useModelOptions";
import { PersonaFormFields } from "../PersonaFormFields";
import { PersonaProviderLabel } from "./PersonaProviderLabel";

const EMPTY_STATUS: Readonly<Record<string, StreamStatus>> = Object.freeze({});

// Per-status row tint while a send/compaction is in flight.
function statusBgClass(status: StreamStatus | undefined): string {
  if (status === "queued") return "bg-green-50";
  if (status === "streaming") return "bg-yellow-50";
  if (status === "retrying") return "bg-red-50";
  // #123 — pale light brown for an in-progress compaction, distinct
  // from the yellow streaming-reply color.
  if (status === "compacting") return "bg-amber-100";
  return "";
}

export function PersonaRow({
  persona,
  selected,
  navSelected,
  onSelectNav,
  cost,
  conversationId,
  flowStepIndex,
  onToggle,
  onSave,
  onDelete,
  allPersonas,
}: {
  persona: Persona;
  selected: boolean;
  navSelected: boolean;
  onSelectNav: (() => void) | undefined;
  cost: CostResult | undefined;
  conversationId: string;
  // #226: index of the upcoming personas-step that includes this
  // persona, or null if this persona isn't part of the next dispatch.
  // Renders as a `[step#N]` debug badge on the persona's secondary
  // line so the user can see whether the cursor matches their mental
  // model without opening the FlowEditor.
  flowStepIndex: number | null;
  onToggle: () => void;
  onSave: (patch: {
    name?: string;
    provider?: ProviderId;
    systemPromptOverride?: string | null;
    modelOverride?: string | null;
    colorOverride?: string | null;
    visibilityDefaults?: Record<string, "y" | "n">;
    seenByEdits?: Record<string, "y" | "n">;
    openaiCompatPreset?: Persona["openaiCompatPreset"];
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  allPersonas: readonly Persona[];
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(persona.name);
  const [provider, setProvider] = useState<ProviderId>(persona.provider);
  const [openaiCompatPreset, setOpenaiCompatPreset] = useState<Persona["openaiCompatPreset"]>(
    persona.openaiCompatPreset,
  );
  const [prompt, setPrompt] = useState(persona.systemPromptOverride ?? "");
  const [model, setModel] = useState(persona.modelOverride ?? "");
  const [colorOverride, setColorOverride] = useState<string | null>(persona.colorOverride);
  const [visDefs, setVisDefs] = useState<Record<string, "y" | "n">>(persona.visibilityDefaults);
  const [seenByEdits, setSeenByEdits] = useState<Record<string, "y" | "n">>({});
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setError(null);
    try {
      const patch: Parameters<typeof onSave>[0] = {
        name,
        provider,
        systemPromptOverride: prompt ? prompt : null,
        modelOverride: model ? model : null,
        colorOverride,
        visibilityDefaults: visDefs,
        openaiCompatPreset: provider === "openai_compat" ? openaiCompatPreset : null,
      };
      if (Object.keys(seenByEdits).length > 0) patch.seenByEdits = seenByEdits;
      await onSave(patch);
      setEditing(false);
    } catch (e) {
      setError(e instanceof PersonaValidationError ? e.message : (e as Error).message);
    }
  };

  const modelListId = `models-${persona.id}`;
  const modelOptions = useModelOptions(
    provider,
    editing,
    modelOptionsFromPricing(provider),
    { openaiCompatPreset },
  );

  const color = persona.colorOverride ?? PROVIDER_COLORS[persona.provider];
  // #31: subscribe to per-persona inflight status. Persona key in the
  // store is the same id used for targeting, so look up by persona.id.
  const status = useSendStore(
    (s) => (s.streamStatusByConversation[conversationId] ?? EMPTY_STATUS)[persona.id],
  );
  const bg = statusBgClass(status);

  // #273: useSortable wires the row into the parent DndContext. We
  // disable drag while editing so a click on a form field doesn't get
  // hijacked once the 4px activation threshold is crossed. transform
  // moves the row visually during drag; transition keeps the post-drop
  // settle smooth.
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: persona.id, disabled: editing });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const navRing = navSelected ? "ring-2 ring-inset ring-blue-400" : "";
  return (
    <li
      ref={setNodeRef}
      style={dragStyle}
      className={`border-b border-neutral-200 px-3 py-2 transition-colors ${bg} ${navRing}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${persona.name}`}
          title="Drag to reorder"
          className="mt-1 cursor-grab touch-none px-0.5 text-neutral-400 hover:text-neutral-700 active:cursor-grabbing"
        >
          ⋮⋮
        </button>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1"
          aria-label={`Select ${persona.name}`}
        />
        <span
          className="mt-1 inline-block h-3 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div
          className={`flex-1 ${onSelectNav ? "cursor-pointer select-none" : ""}`}
          onClick={onSelectNav}
          role={onSelectNav ? "button" : undefined}
          aria-pressed={onSelectNav ? navSelected : undefined}
          title={
            onSelectNav
              ? navSelected
                ? "Click to scope chat-header arrows back to user commands"
                : `Click to scope chat-header arrows to ${persona.name}'s messages`
              : undefined
          }
        >
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-medium text-neutral-900">{persona.name}</div>
            <div
              className="text-xs tabular-nums text-neutral-600"
              title={cost?.approximate ? "approximate" : undefined}
            >
              {formatPersonaCost(cost)}
            </div>
          </div>
          <div className="text-xs text-neutral-600">
            {/* #141 hosting tag + provider/preset label.
                #171: openai_compat personas show their preset
                display name (and per-preset hosting country) instead
                of the generic "openai_compat" placeholder. */}
            <PersonaProviderLabel persona={persona} />
            {persona.modelOverride ? ` · ${persona.modelOverride}` : ""}
            {/* #226: debug step badge — shows which flow step number
                this persona's upcoming dispatch corresponds to, so the
                user can spot a stuck cursor without opening the
                FlowEditor. */}
            {flowStepIndex !== null ? (
              <span className="ml-1 text-amber-700">[step#{flowStepIndex}]</span>
            ) : null}
          </div>
        </div>
        <button
          onClick={() => setEditing((x) => !x)}
          className="text-xs text-neutral-500 hover:text-neutral-900"
        >
          {editing ? "close" : "edit"}
        </button>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2 text-xs">
          <PersonaFormFields
            name={name}
            onNameChange={setName}
            provider={provider}
            onProviderChange={setProvider}
            openaiCompatPreset={openaiCompatPreset}
            onOpenaiCompatPresetChange={setOpenaiCompatPreset}
            model={model}
            onModelChange={setModel}
            prompt={prompt}
            onPromptChange={setPrompt}
            colorOverride={colorOverride}
            onColorOverrideChange={setColorOverride}
            visDefs={visDefs}
            onVisDefsChange={setVisDefs}
            seenByEdits={seenByEdits}
            onSeenByEditsChange={setSeenByEdits}
            siblings={allPersonas.filter((p) => p.id !== persona.id)}
            self={persona}
            modelListId={modelListId}
            modelOptions={modelOptions}
          />
          {error ? <div className="text-red-600">{error}</div> : null}
          <div className="flex gap-2">
            <PrimaryButton onClick={() => void save()} size="sm">
              Save
            </PrimaryButton>
            <DangerButton onClick={() => void onDelete()} size="sm">
              Delete
            </DangerButton>
          </div>
        </div>
      ) : null}
    </li>
  );
}
