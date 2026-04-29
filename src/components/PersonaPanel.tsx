// ------------------------------------------------------------------
// Component: PersonaPanel
// Responsibility: List, create, edit, and delete personas for the
//                 current conversation. Talks to personas/service
//                 (validation) and the personasStore (reactive cache).
// ------------------------------------------------------------------

import { useState } from "react";
import type { Conversation, Flow, Message, Persona, ProviderId } from "@/lib/types";
import * as flowsRepo from "@/lib/persistence/flows";
import { nextPersonasStepPersonaIds } from "@/lib/app/flowSelectionSync";
import { invalidateRepoQuery } from "@/lib/data/useRepoQuery";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { formatHostingTag } from "@/lib/providers/derived";
import { userSelectableProviderIds } from "@/lib/providers/userSelectable";
import { PROVIDER_COLORS } from "@/lib/providers/derived";
import { computePersonaCosts, formatPersonaCost } from "@/lib/pricing/personaCosts";
import type { CostResult } from "@/lib/pricing/estimator";
import { useModelOptions, modelOptionsFromPricing } from "./useModelOptions";
import { PersonaFormFields } from "./PersonaFormFields";
import { useOpenAICompatPresets } from "./useOpenAICompatPresets";
import {
  createPersona,
  deletePersona,
  updatePersona,
  applySeenByEdits,
  PersonaValidationError,
} from "@/lib/personas/service";
import { exportPersonasToFile, importPersonasFromFile } from "@/lib/personas/fileOps";
import { ensureIdentityPin } from "@/lib/personas/identityPin";
import * as messagesRepo from "@/lib/persistence/messages";
import { readCachedMessages } from "@/hooks/cacheReaders";
import { rebuildVisibilityFromPersonaDefaults } from "@/lib/personas/visibilityRebuild";
import { usePersonasStore } from "@/stores/personasStore";
import { useRepoQuery } from "@/lib/data/useRepoQuery";
import * as personasRepo from "@/lib/persistence/personas";
import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useSendStore, type StreamStatus } from "@/stores/sendStore";
import { useUiStore } from "@/stores/uiStore";
import { OutlineButton, PrimaryButton, DangerButton } from "@/components/ui/Button";
import { FlowEditor } from "./FlowEditor";

const EMPTY_STATUS: Readonly<Record<string, StreamStatus>> = Object.freeze({});

function statusBgClass(status: StreamStatus | undefined): string {
  if (status === "queued") return "bg-green-50";
  if (status === "streaming") return "bg-yellow-50";
  if (status === "retrying") return "bg-red-50";
  // #123 — pale light brown for an in-progress compaction, distinct
  // from the yellow streaming-reply color.
  if (status === "compacting") return "bg-amber-100";
  return "";
}

const SELECTABLE_PROVIDER_IDS = userSelectableProviderIds(import.meta.env.DEV);
const DEFAULT_NEW_PROVIDER: ProviderId = SELECTABLE_PROVIDER_IDS[0] ?? "claude";

const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);
const EMPTY_SEL: readonly string[] = Object.freeze([]);

const EMPTY_MESSAGES: readonly import("@/lib/types").Message[] = Object.freeze([]);

export function PersonaPanel({
  conversation,
  navPersonaId = null,
  onSelectNavPersona,
}: {
  conversation: Conversation;
  // #137 nav-scope: which persona the chat-header arrows are scoped
  // to. Independent of the send-target checkboxes.
  navPersonaId?: string | null;
  onSelectNavPersona?: (id: string) => void;
}): JSX.Element {
  const collapsed = useUiStore((s) => s.personaPanelCollapsed);
  const toggleCollapse = useUiStore((s) => s.togglePersonaPanel);
  const fontScale = useUiStore((s) => s.chatFontScale);
  // #135: html root is scaled for chat/sidebar/composer zoom. Counter-
  // scale the persona panel via CSS zoom so it stays at baseline size
  // — otherwise it gets too cramped at 150%+.
  const counterScaleStyle: React.CSSProperties =
    fontScale === 1 ? {} : { zoom: 1 / fontScale };
  if (collapsed) {
    return (
      <aside
        style={counterScaleStyle}
        className="flex w-5 flex-col items-center border-l border-neutral-200 bg-neutral-50"
      >
        <button
          onClick={toggleCollapse}
          title="Expand personas panel"
          aria-label="Expand personas panel"
          className="mt-2 text-sm text-neutral-500 hover:text-neutral-900"
        >
          ‹
        </button>
      </aside>
    );
  }
  return (
    <PersonaPanelExpanded
      conversation={conversation}
      onCollapse={toggleCollapse}
      counterScaleStyle={counterScaleStyle}
      navPersonaId={navPersonaId}
      onSelectNavPersona={onSelectNavPersona}
    />
  );
}

function PersonaPanelExpanded({
  conversation,
  onCollapse,
  counterScaleStyle,
  navPersonaId,
  onSelectNavPersona,
}: {
  conversation: Conversation;
  onCollapse: () => void;
  counterScaleStyle: React.CSSProperties;
  navPersonaId: string | null;
  onSelectNavPersona: ((id: string) => void) | undefined;
}): JSX.Element {
  // #185/#211: personas come from useRepoQuery. The cache is seeded
  // by personasStore.load() and updated in-place by upsert / remove,
  // so consumers see updates without re-fetching.
  const personasQuery = useRepoQuery<Persona[]>(
    ["personas", conversation.id],
    () => personasRepo.listPersonas(conversation.id),
  );
  const personas = personasQuery.data ?? EMPTY_PERSONAS;
  const selection =
    usePersonasStore((s) => s.selectionByConversation[conversation.id]) ?? EMPTY_SEL;
  const messagesQuery = useRepoQuery<Message[]>(
    ["messages", conversation.id],
    () => messagesRepo.listMessages(conversation.id),
  );
  const messages = messagesQuery.data ?? EMPTY_MESSAGES;
  const upsert = usePersonasStore((s) => s.upsert);
  const remove = usePersonasStore((s) => s.remove);
  const setSelection = usePersonasStore((s) => s.setSelection);
  const addToSelection = usePersonasStore((s) => s.addToSelection);
  const costs = computePersonaCosts(messages, personas);

  // #223: load the conversation's flow (if any) so the dedicated
  // "Conversation flow" row can render above the persona list.
  // Routed through repoQueryCache so the row reflects cursor advances
  // (sendMessage's pauseFlow path) and editor saves without us having
  // to thread bespoke reload signals through each surface — the deps
  // factories invalidate ["flow"] after each write.
  const flowQuery = useRepoQuery<Flow | null>(
    ["flow", conversation.id],
    () => flowsRepo.getFlow(conversation.id),
  );
  const flow = flowQuery.data ?? null;

  const toggle = (id: string): void => {
    const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
    setSelection(conversation.id, next);
    // #223: manual persona edit drops flow_mode — the user is taking
    // control. The flow itself stays attached; they can re-engage by
    // ticking the "Conversation flow" row.
    if (conversation.flowMode) {
      void useConversationsStore.getState().setFlowMode(conversation.id, false);
    }
  };

  // #223: tick / untick the "Conversation flow" row.
  const onToggleFlowMode = async (): Promise<void> => {
    const wantOn = !conversation.flowMode;
    if (wantOn && flow) {
      // Sync selection to the next personas-step's set so the user's
      // first follow-up under flow-mode lines up immediately.
      const ids = nextPersonasStepPersonaIds(flow);
      if (ids && ids.length > 0) setSelection(conversation.id, ids);
    }
    await useConversationsStore.getState().setFlowMode(conversation.id, wantOn);
    // Bump the flow cache so the row's "→ {next-personas}" hint
    // re-derives from a fresh read (cursor may have moved between
    // the last load and now via a concurrent send).
    invalidateRepoQuery(["flow"]);
  };

  // #218: flow editor opens on click of the "Edit conversation flow"
  // link at the bottom. Closes on save/cancel and when the persona
  // list changes underneath us so the editor never points at stale
  // ids.
  const [showFlowEditor, setShowFlowEditor] = useState(false);

  return (
    <aside
      style={counterScaleStyle}
      className="flex w-72 flex-col border-l border-neutral-200 bg-neutral-50"
    >
      <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        <span>Personas</span>
        <button
          onClick={onCollapse}
          title="Collapse personas panel"
          aria-label="Collapse personas panel"
          className="text-sm font-normal normal-case text-neutral-400 hover:text-neutral-900"
        >
          ›
        </button>
      </header>
      <CreateForm
        conversationId={conversation.id}
        conversationTitle={conversation.title}
        personas={personas}
        onCreated={(p) => {
          upsert(p);
          // #37: auto-select so the next implicit send reaches the
          // freshly added persona without the user having to remember
          // to tick its checkbox.
          addToSelection(conversation.id, [p.id]);
          // #94 → #202: rebuild persona_visibility from current defaults
          // and update the store with the resulting matrix so the UI
          // re-renders. The rebuild helper also dual-writes the legacy
          // JSON column so rollbacks remain coherent.
          void rebuildVisibilityFromPersonaDefaults(conversation.id).then(
            (matrix) =>
              useConversationsStore
                .getState()
                .setVisibilityMatrix(conversation.id, matrix),
          );
        }}
      />
      {flow ? (
        <FlowModeRow
          flow={flow}
          personas={personas}
          flowMode={conversation.flowMode ?? false}
          onToggle={() => void onToggleFlowMode()}
        />
      ) : null}
      <ul className="flex-1 overflow-auto">
        {personas.map((p) => (
          <PersonaRow
            key={p.id}
            persona={p}
            selected={selection.includes(p.id)}
            navSelected={navPersonaId === p.id}
            onSelectNav={onSelectNavPersona ? () => onSelectNavPersona(p.id) : undefined}
            cost={costs[p.id]}
            conversationId={conversation.id}
            onToggle={() => toggle(p.id)}
            onSave={async (patch) => {
              const { seenByEdits: sbe, ...personaPatch } = patch;
              const next = await updatePersona({ id: p.id, ...personaPatch });
              upsert(next);
              // #94: apply "seen by" edits to sibling personas.
              if (sbe) {
                const siblings = personas.filter((x) => x.id !== p.id);
                await applySeenByEdits(next.nameSlug, sbe, siblings);
                // Reload siblings so the store reflects cross-edits.
                await usePersonasStore.getState().load(conversation.id);
              }
              // If the rename changed the name, refresh the identity
              // pin in-place so the LLM hears the new name on next send.
              if (patch.name && patch.name !== p.name) {
                const history = await messagesRepo.listMessages(conversation.id);
                await ensureIdentityPin(conversation.id, next, history, messagesRepo);
                await useMessagesStore.getState().load(conversation.id);
              }
              // #94 → #202: rebuild persona_visibility after defaults change.
              if (patch.visibilityDefaults !== undefined || sbe) {
                const matrix = await rebuildVisibilityFromPersonaDefaults(
                  conversation.id,
                );
                await useConversationsStore
                  .getState()
                  .setVisibilityMatrix(conversation.id, matrix);
              }
            }}
            onDelete={async () => {
              await deletePersona(p.id);
              remove(p);
              // #94 → #202: rebuild persona_visibility after removal.
              const matrix = await rebuildVisibilityFromPersonaDefaults(
                conversation.id,
              );
              await useConversationsStore
                .getState()
                .setVisibilityMatrix(conversation.id, matrix);
            }}
            allPersonas={personas}
          />
        ))}
        {personas.length === 0 ? (
          <li className="px-3 py-3 text-xs text-neutral-500">No personas yet.</li>
        ) : null}
      </ul>
      {/* #218: small link to the experimental flow editor. Hidden when
          there are no personas (nothing meaningful to flow yet). */}
      {personas.length > 0 ? (
        <div className="border-t border-neutral-200 px-3 py-2">
          <button
            onClick={() => setShowFlowEditor(true)}
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
          >
            Edit conversation flow
          </button>
          <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium uppercase text-amber-800">
            experimental
          </span>
        </div>
      ) : null}
      {showFlowEditor ? (
        <FlowEditor
          conversationId={conversation.id}
          personas={personas}
          onClose={() => {
            setShowFlowEditor(false);
          }}
        />
      ) : null}
    </aside>
  );
}

function PersonaRow({
  persona,
  selected,
  navSelected,
  onSelectNav,
  cost,
  conversationId,
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
  onToggle: () => void;
  onSave: (patch: {
    name?: string;
    provider?: ProviderId;
    systemPromptOverride?: string | null;
    modelOverride?: string | null;
    colorOverride?: string | null;
    visibilityDefaults?: Record<string, "y" | "n">;
    seenByEdits?: Record<string, "y" | "n">;
    runsAfter?: string[];
    apertusProductId?: string | null;
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
  const [runsAfter, setRunsAfter] = useState<string[]>(persona.runsAfter);
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
        runsAfter,
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

  const navRing = navSelected ? "ring-2 ring-inset ring-blue-400" : "";
  return (
    <li className={`border-b border-neutral-200 px-3 py-2 transition-colors ${bg} ${navRing}`}>
      <div className="flex items-start gap-2">
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
            {persona.runsAfter.length > 0
              ? ` · after ${persona.runsAfter.map((id) => labelFor(id, allPersonas)).join(", ")}`
              : ""}
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
            promptRows={3}
          />
          <Field label="Runs after">
            <div className="flex flex-wrap gap-2">
              {allPersonas
                .filter((p) => p.id !== persona.id)
                .map((p) => (
                  <label key={p.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={runsAfter.includes(p.id)}
                      onChange={(e) =>
                        setRunsAfter((prev) =>
                          e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <span className="text-neutral-800">{p.name}</span>
                  </label>
                ))}
              {allPersonas.filter((p) => p.id !== persona.id).length === 0 && (
                <span className="text-neutral-400">(no other personas)</span>
              )}
            </div>
          </Field>
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

function CreateForm({
  conversationId,
  conversationTitle,
  personas,
  onCreated,
}: {
  conversationId: string;
  conversationTitle: string;
  personas: readonly Persona[];
  onCreated: (p: Persona) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_NEW_PROVIDER);
  const [openaiCompatPreset, setOpenaiCompatPreset] = useState<Persona["openaiCompatPreset"]>(null);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState<"inherit" | "new">("inherit");
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const [visDefs, setVisDefs] = useState<Record<string, "y" | "n">>({});
  const [seenByEdits, setSeenByEdits] = useState<Record<string, "y" | "n">>({});
  const [error, setError] = useState<string | null>(null);

  const modelListId = "create-model-list";
  const modelOptions = useModelOptions(provider, open, [], { openaiCompatPreset });

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      const history = readCachedMessages(conversationId);
      const currentIdx = scope === "inherit" ? 0 : history.length;
      const p = await createPersona({
        conversationId,
        provider,
        name,
        currentMessageIndex: currentIdx,
        ...(model ? { modelOverride: model } : {}),
        ...(prompt ? { systemPromptOverride: prompt } : {}),
        ...(colorOverride ? { colorOverride } : {}),
        visibilityDefaults: visDefs,
        ...(provider === "openai_compat" && openaiCompatPreset
          ? { openaiCompatPreset }
          : {}),
      });
      // #94: apply "seen by" edits to existing personas.
      if (Object.keys(seenByEdits).length > 0) {
        const siblings = [...personas];
        await applySeenByEdits(p.nameSlug, seenByEdits, siblings);
      }
      const scopeInfo = scope === "inherit" ? ("inherit" as const) : { newAtMsg: history.length };
      await ensureIdentityPin(conversationId, p, history, messagesRepo, scopeInfo);
      await useMessagesStore.getState().load(conversationId);
      onCreated(p);
      setName("");
      setModel("");
      setPrompt("");
      setScope("inherit");
      setColorOverride(null);
      setVisDefs({});
      setSeenByEdits({});
      setOpenaiCompatPreset(null);
      setOpen(false);
    } catch (e) {
      setError(e instanceof PersonaValidationError ? e.message : (e as Error).message);
    }
  };

  const onExport = async (): Promise<void> => {
    const r = await exportPersonasToFile(
      conversationTitle,
      personas,
      useUiStore.getState().workingDir,
    );
    if (r.ok) {
      await useMessagesStore
        .getState()
        .appendNotice(conversationId, `personas exported to ${r.path}.`);
    }
  };
  const onImport = async (): Promise<void> => {
    const history = readCachedMessages(conversationId);
    const r = await importPersonasFromFile(
      conversationId,
      history.length,
      useUiStore.getState().workingDir,
    );
    if (r.ok === false) {
      if (r.reason === "error") {
        await useMessagesStore
          .getState()
          .appendNotice(conversationId, `persona import failed: ${r.message}`);
      }
      return;
    }
    for (const p of r.created) onCreated(p);
    const lines = [`imported ${r.created.length} persona${r.created.length === 1 ? "" : "s"}.`];
    if (r.skipped.length > 0) {
      lines.push(`skipped (name in use): ${r.skipped.join(", ")}.`);
    }
    if (r.visibilityWarnings.length > 0) {
      lines.push(`visibility: ${r.visibilityWarnings.join("; ")}.`);
    }
    await useMessagesStore.getState().appendNotice(conversationId, lines.join(" "));
  };

  if (!open) {
    return (
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-xs">
        <button onClick={() => setOpen(true)} className="text-neutral-600 hover:text-neutral-900">
          + Add persona
        </button>
        <div className="flex gap-2 text-neutral-500">
          <button
            onClick={() => void onImport()}
            className="hover:text-neutral-900 hover:underline"
          >
            Import
          </button>
          <span>·</span>
          <button
            onClick={() => void onExport()}
            disabled={personas.length === 0}
            className="hover:text-neutral-900 hover:underline disabled:opacity-40 disabled:no-underline"
          >
            Export
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-b border-neutral-200 px-3 py-2 text-xs">
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
        siblings={personas}
        self={null}
        modelListId={modelListId}
        modelOptions={modelOptions}
        nameAutoFocus
        namePlaceholder="Alice"
        promptPlaceholder="(inherits global)"
        promptRows={2}
      />
      <Field label="Scope">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "inherit" | "new")}
          className="w-full rounded border border-neutral-300 px-2 py-1"
        >
          <option value="inherit">inherit (sees full history)</option>
          <option value="new">new (sees only future messages)</option>
        </select>
      </Field>
      {error ? <div className="text-red-600">{error}</div> : null}
      <div className="flex gap-2">
        <PrimaryButton onClick={() => void submit()} disabled={!name.trim()} size="sm">
          Create
        </PrimaryButton>
        <OutlineButton
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          size="sm"
        >
          Cancel
        </OutlineButton>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

function labelFor(id: string, all: readonly Persona[]): string {
  return all.find((p) => p.id === id)?.name ?? id;
}

// #171: render the persona's provider/preset label with its hosting
// tag. For openai_compat personas, look up the preset and use its
// display name + country; for everything else the registry holds the
// truth.
function PersonaProviderLabel({ persona }: { persona: Persona }): JSX.Element {
  const presets = useOpenAICompatPresets();
  if (persona.provider === "openai_compat" && persona.openaiCompatPreset) {
    const ref = persona.openaiCompatPreset;
    const match = presets.find(
      (p) =>
        p.ref.kind === ref.kind &&
        (p.ref.kind === "builtin"
          ? p.ref.id === (ref as { kind: "builtin"; id: string }).id
          : p.ref.name === (ref as { kind: "custom"; name: string }).name),
    );
    const tag = formatHostingTag(match?.hostingCountry ?? null);
    const label = match?.displayName ?? "openai-compat";
    return <>{tag ? `${tag} ${label}` : label}</>;
  }
  const tag = formatHostingTag(PROVIDER_REGISTRY[persona.provider].hostingCountry);
  return <>{tag ? `${tag} ${persona.provider}` : persona.provider}</>;
}

// #223: dedicated row for the conversation flow's "auto-managed
// selection" toggle. Shown only when a flow is attached. Ticked when
// flowMode is on; the label hints at the upcoming personas-step so
// the user can see where the next implicit follow-up will land.
function FlowModeRow({
  flow,
  personas,
  flowMode,
  onToggle,
}: {
  flow: Flow;
  personas: readonly Persona[];
  flowMode: boolean;
  onToggle: () => void;
}): JSX.Element {
  const nextIds = nextPersonasStepPersonaIds(flow) ?? [];
  const personaById = new Map(personas.map((p) => [p.id, p] as const));
  const nextNames =
    nextIds.length === 0
      ? "(no personas-step in this cycle)"
      : nextIds.map((id) => personaById.get(id)?.name ?? id).join(", ");
  return (
    <div
      className={`flex items-start gap-2 border-b border-neutral-200 px-3 py-2 ${
        flowMode ? "bg-amber-50" : "bg-white"
      }`}
    >
      <input
        type="checkbox"
        checked={flowMode}
        onChange={onToggle}
        className="mt-1"
        aria-label="Conversation flow auto-selection"
        title={
          flowMode
            ? "Flow is driving the persona selection. Tick a persona below to take manual control."
            : "Tick to follow the conversation flow — selection auto-syncs to the next step."
        }
      />
      <div className="flex-1 text-xs">
        <div className="font-medium text-neutral-900">↻ Conversation flow</div>
        <div className="text-neutral-700">→ {nextNames}</div>
      </div>
    </div>
  );
}
