// ------------------------------------------------------------------
// Component: PersonaPanelExpanded
// Responsibility: The expanded persona panel body — header, create
//                 form, flow-mode row, the drag-reorderable persona
//                 list, the flow-editor link, and the spend table. Owns
//                 the per-persona onSave/onDelete wiring and selection
//                 use cases. Extracted from PersonaPanel.tsx in #319;
//                 PersonaPanel is now just the collapsed/expanded root.
// Collaborators: persona/{CreateForm,FlowModeRow,PersonaRow},
//                FlowEditor, ProviderSpendTable, the stores + use cases.
// ------------------------------------------------------------------

import { useState } from "react";
import type { Conversation, Flow, Message, Persona } from "@/lib/types";
import { useFlowsStore } from "@/stores/flowsStore";
import { nextPersonasStepPersonaIds, upcomingStepIndexForPersona } from "@/lib/app/flowSelectionSync";
import { computePersonaCosts } from "@/lib/pricing/personaCosts";
import { updatePersona, deletePersona, applySeenByEdits } from "@/lib/personas/service";
import { ensureIdentityPinTopLevel } from "@/lib/personas/identityPin";
import { backgroundTask } from "@/lib/observability/backgroundTask";
import { setSelection as setSelectionUseCase } from "@/lib/app/setSelection";
import { reorderPersonas } from "@/lib/app/reorderPersonas";
import { computePersonaReorder } from "@/lib/personas/reorderComputation";
import { rebuildVisibilityFromPersonaDefaults } from "@/lib/personas/visibilityRebuild";
import { usePersonasStore } from "@/stores/personasStore";
import { useRepoQuery, getRepoQueryCache, invalidateRepoQuery } from "@/lib/data/useRepoQuery";
import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { FlowEditor } from "../FlowEditor";
import { ProviderSpendTable } from "../ProviderSpendTable";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CreateForm } from "./CreateForm";
import { FlowModeRow } from "./FlowModeRow";
import { PersonaRow } from "./PersonaRow";

const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);
const EMPTY_SEL: readonly string[] = Object.freeze([]);
const EMPTY_MESSAGES: readonly Message[] = Object.freeze([]);

export function PersonaPanelExpanded({
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
    () => usePersonasStore.getState().listPersonas(conversation.id),
  );
  const personas = personasQuery.data ?? EMPTY_PERSONAS;
  const selection =
    usePersonasStore((s) => s.selectionByConversation[conversation.id]) ?? EMPTY_SEL;
  const messagesQuery = useRepoQuery<Message[]>(
    ["messages", conversation.id],
    () => useMessagesStore.getState().listMessages(conversation.id),
  );
  const messages = messagesQuery.data ?? EMPTY_MESSAGES;
  const upsert = usePersonasStore((s) => s.upsert);
  const remove = usePersonasStore((s) => s.remove);
  // #271: setSelection / addToSelection both route through the
  // lib/app use case (UI cache update + persistent write); the
  // persona store no longer owns the persistent half.
  const setSelection = (conversationId: string, keys: readonly string[]): void => {
    backgroundTask("PersonaPanel.setSelection", () =>
      setSelectionUseCase(
        {
          setLocalSelection: (id, k) =>
            usePersonasStore.getState().setSelection(id, [...k]),
          setSelectedPersonasPersistent: (id, k) =>
            useConversationsStore.getState().setSelectedPersonas(id, [...k]),
        },
        conversationId,
        keys,
      ),
    );
  };
  const addToSelection = (conversationId: string, ids: readonly string[]): void => {
    const current =
      usePersonasStore.getState().selectionByConversation[conversationId] ?? [];
    const seen = new Set(current);
    const next = [...current];
    for (const k of ids) {
      if (!seen.has(k)) {
        next.push(k);
        seen.add(k);
      }
    }
    setSelection(conversationId, next);
  };
  const costs = computePersonaCosts(messages, personas);

  // #223: load the conversation's flow (if any) so the dedicated
  // "Conversation flow" row can render above the persona list.
  // Routed through repoQueryCache so the row reflects cursor advances
  // (sendMessage's pauseFlow path) and editor saves without us having
  // to thread bespoke reload signals through each surface — the deps
  // factories invalidate ["flow"] after each write.
  const flowQuery = useRepoQuery<Flow | null>(
    ["flow", conversation.id],
    () => useFlowsStore.getState().getFlow(conversation.id),
  );
  const flow = flowQuery.data ?? null;

  const toggle = (id: string): void => {
    const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
    setSelection(conversation.id, next);
    // #223: manual persona edit drops flow_mode — the user is taking
    // control. The flow itself stays attached; they can re-engage by
    // ticking the "Conversation flow" row.
    if (conversation.flowMode) {
      backgroundTask("PersonaPanel.dropFlowModeOnEdit", () =>
        useConversationsStore.getState().setFlowMode(conversation.id, false),
      );
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

  // #273: drag-and-drop reorder via @dnd-kit. PointerSensor handles
  // mouse/touch; KeyboardSensor gives space-to-pick-up + arrows-to-move
  // for free. activationConstraint.distance keeps a click-on-handle
  // from triggering an accidental drag — only after 4px of movement.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over) return;
    // #319: the reorder math (incl. the #273 sortOrder-renumber that
    // cols-mode column ordering depends on) lives in computePersonaReorder.
    const result = computePersonaReorder(personas, String(active.id), String(over.id));
    if (!result) return;
    // Optimistic cache update so the row visually settles in its new
    // slot before the persistent rewrite resolves. On rejection,
    // invalidateRepoQuery refetches the canonical order from DB.
    getRepoQueryCache().set<Persona[]>(["personas", conversation.id], result.reordered);
    backgroundTask("PersonaPanel.reorder", async () => {
      try {
        await reorderPersonas(conversation.id, result.nextOrder);
      } catch (err) {
        // Snap back to the canonical order. backgroundTask already logs
        // the failure; this re-read keeps the UI honest.
        invalidateRepoQuery(["personas", conversation.id]);
        throw err;
      }
    });
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
        flow={flow}
        onCreated={(p) => {
          upsert(p);
          // #37: auto-select so the next implicit send reaches the
          // freshly added persona without the user having to remember
          // to tick its checkbox.
          addToSelection(conversation.id, [p.id]);
          // #94 → #202: rebuild persona_visibility from current defaults
          // and update the cache so the UI re-renders. #279: cache-only
          // update; the rebuild already persisted.
          backgroundTask("PersonaPanel.rebuildVisibilityAfterCreate", async () => {
            const matrix = await rebuildVisibilityFromPersonaDefaults(conversation.id);
            useConversationsStore
              .getState()
              .applyVisibilityMatrixCache(conversation.id, matrix);
          });
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
      <DndContext
        sensors={dndSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={personas.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
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
                flowStepIndex={flow ? upcomingStepIndexForPersona(flow, p.id) : null}
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
                    const history = await useMessagesStore.getState().listMessages(conversation.id);
                    await ensureIdentityPinTopLevel(conversation.id, next, history);
                    await useMessagesStore.getState().load(conversation.id);
                  }
                  // #94 → #202 / #266: rebuild persona_visibility only when
                  // defaults actually changed (deep compare) or the user
                  // made explicit cross-persona seenByEdits — the form
                  // always includes visibilityDefaults in the patch, so an
                  // undefined-check would fire on every save and wipe manual
                  // matrix toggles.
                  const visibilityDefaultsChanged =
                    patch.visibilityDefaults !== undefined &&
                    JSON.stringify(patch.visibilityDefaults) !==
                      JSON.stringify(p.visibilityDefaults);
                  if (visibilityDefaultsChanged || sbe) {
                    // #279: rebuild already wrote persona_visibility; cache-only here.
                    const matrix = await rebuildVisibilityFromPersonaDefaults(
                      conversation.id,
                    );
                    useConversationsStore
                      .getState()
                      .applyVisibilityMatrixCache(conversation.id, matrix);
                  }
                }}
                onDelete={async () => {
                  await deletePersona(p.id);
                  remove(p);
                  // #94 → #202: rebuild persona_visibility after removal.
                  // #279: cache-only update; rebuild already persisted.
                  const matrix = await rebuildVisibilityFromPersonaDefaults(
                    conversation.id,
                  );
                  useConversationsStore
                    .getState()
                    .applyVisibilityMatrixCache(conversation.id, matrix);
                }}
                allPersonas={personas}
              />
            ))}
            {personas.length === 0 ? (
              <li className="px-3 py-3 text-xs text-neutral-500">No personas yet.</li>
            ) : null}
          </ul>
        </SortableContext>
      </DndContext>
      {/* #218: small link to the flow editor. Hidden when there are no
          personas (nothing meaningful to flow yet). */}
      {personas.length > 0 ? (
        <div className="border-t border-neutral-200 px-3 py-2">
          <button
            onClick={() => setShowFlowEditor(true)}
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
          >
            Edit conversation flow
          </button>
        </div>
      ) : null}
      {/* #253: spend table — global view (all conversations, all time)
          deliberately placed here while we feel out the right home for
          it. The view is per-provider with current API keys; rows
          without a key are filtered out. */}
      <div className="px-3 pb-3">
        <ProviderSpendTable />
      </div>
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
