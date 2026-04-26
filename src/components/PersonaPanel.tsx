// ------------------------------------------------------------------
// Component: PersonaPanel
// Responsibility: List, create, edit, and delete personas for the
//                 current conversation. Talks to personas/service
//                 (validation) and the personasStore (reactive cache).
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { Conversation, Persona, ProviderId } from "@/lib/types";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { formatHostingTag } from "@/lib/providers/derived";
import { userSelectableProviderIds } from "@/lib/providers/userSelectable";
import { PROVIDER_COLORS } from "@/lib/providers/derived";
import { PRICING } from "@/lib/pricing/table";
import { computePersonaCosts, formatPersonaCost } from "@/lib/pricing/personaCosts";
import type { CostResult } from "@/lib/pricing/estimator";
import { listModelInfos, formatTokenLimit, type ModelInfo } from "@/lib/providers/models";
import { keychain } from "@/lib/tauri/keychain";
import {
  createPersona,
  deletePersona,
  updatePersona,
  applySeenByEdits,
  PersonaValidationError,
} from "@/lib/personas/service";
import { exportPersonasToFile, importPersonasFromFile } from "@/lib/personas/fileOps";
import { ensureIdentityPin } from "@/lib/personas/identityPin";
import { getSetting } from "@/lib/persistence/settings";
import { APERTUS_PRODUCT_ID_KEY } from "@/lib/settings/keys";
import * as messagesRepo from "@/lib/persistence/messages";
import { buildMatrixFromDefaults } from "@/lib/personas/service";
import { usePersonasStore } from "@/stores/personasStore";
import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useSendStore, type StreamStatus } from "@/stores/sendStore";
import { useUiStore } from "@/stores/uiStore";

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
  const personas = usePersonasStore((s) => s.byConversation[conversation.id]) ?? EMPTY_PERSONAS;
  const selection =
    usePersonasStore((s) => s.selectionByConversation[conversation.id]) ?? EMPTY_SEL;
  const messages = useMessagesStore((s) => s.byConversation[conversation.id]) ?? EMPTY_MESSAGES;
  const upsert = usePersonasStore((s) => s.upsert);
  const remove = usePersonasStore((s) => s.remove);
  const setSelection = usePersonasStore((s) => s.setSelection);
  const addToSelection = usePersonasStore((s) => s.addToSelection);
  const costs = computePersonaCosts(messages, personas);

  const toggle = (id: string): void => {
    const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
    setSelection(conversation.id, next);
  };

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
          // #94: seed the visibility matrix from all persona defaults.
          const all = [...personas, p];
          const matrix = buildMatrixFromDefaults(all);
          void useConversationsStore
            .getState()
            .setVisibilityMatrix(conversation.id, matrix);
        }}
      />
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
              // #94: rebuild visibility matrix after defaults change.
              if (patch.visibilityDefaults !== undefined || sbe) {
                const fresh = usePersonasStore.getState().byConversation[conversation.id] ?? [];
                const matrix = buildMatrixFromDefaults(fresh);
                void useConversationsStore
                  .getState()
                  .setVisibilityMatrix(conversation.id, matrix);
              }
            }}
            onDelete={async () => {
              await deletePersona(p.id);
              remove(p);
              // #94: rebuild matrix after removal.
              const remaining = personas.filter((x) => x.id !== p.id);
              const matrix = buildMatrixFromDefaults(remaining);
              void useConversationsStore
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
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  allPersonas: readonly Persona[];
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(persona.name);
  const [provider, setProvider] = useState<ProviderId>(persona.provider);
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
      };
      if (Object.keys(seenByEdits).length > 0) patch.seenByEdits = seenByEdits;
      await onSave(patch);
      setEditing(false);
    } catch (e) {
      setError(e instanceof PersonaValidationError ? e.message : (e as Error).message);
    }
  };

  const [modelOptions, setModelOptions] = useState<ModelInfo[]>(() =>
    Object.keys(PRICING[provider] ?? {}).map((id) => ({ id })),
  );
  const modelListId = `models-${persona.id}`;

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    void (async () => {
      const key = PROVIDER_REGISTRY[provider].requiresKey
        ? await keychain.get(PROVIDER_REGISTRY[provider].keychainKey)
        : null;
      const pid = await getSetting(APERTUS_PRODUCT_ID_KEY);
      const infos = await listModelInfos(provider, key, { apertusProductId: pid });
      if (!cancelled) setModelOptions(infos);
    })();
    return () => {
      cancelled = true;
    };
  }, [editing, provider]);

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
            {/* #141: hosting-country tag prefixes the persona's provider id */}
            {(() => {
              const tag = formatHostingTag(PROVIDER_REGISTRY[persona.provider].hostingCountry);
              return tag ? `${tag} ${persona.provider}` : persona.provider;
            })()}
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
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-neutral-300 px-2 py-1"
            />
          </Field>
          <Field label="Provider">
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as ProviderId);
                setModel("");
              }}
              className="w-full rounded border border-neutral-300 px-2 py-1"
            >
              {SELECTABLE_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {/* #141: hosting-country tag prefixes the display name */}
                  {formatHostingTag(PROVIDER_REGISTRY[id].hostingCountry)
                    ? `${formatHostingTag(PROVIDER_REGISTRY[id].hostingCountry)} ${PROVIDER_REGISTRY[id].displayName}`
                    : PROVIDER_REGISTRY[id].displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model override">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list={modelListId}
              placeholder={PROVIDER_REGISTRY[provider].defaultModel}
              className="w-full rounded border border-neutral-300 px-2 py-1"
            />
            <datalist id={modelListId}>
              {modelOptions.map((m) => {
                // #141: prefix the model id with the provider's hosting
                // country tag so the data-sovereignty signal stays
                // visible in the picker too.
                const tag = formatHostingTag(PROVIDER_REGISTRY[provider].hostingCountry);
                const tokens = m.maxTokens ? ` — ${formatTokenLimit(m.maxTokens)}` : "";
                return (
                  <option key={m.id} value={m.id}>
                    {tag ? `${tag} ${m.id}${tokens}` : `${m.id}${tokens}`}
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
                onChange={(e) => setColorOverride(e.target.value)}
                className="h-6 w-8 cursor-pointer rounded border border-neutral-300 p-0"
              />
              <span className="text-neutral-500">
                {colorOverride ? "custom" : "provider default"}
              </span>
              {colorOverride !== null && (
                <button
                  type="button"
                  onClick={() => setColorOverride(null)}
                  className="text-neutral-500 hover:text-neutral-900"
                >
                  reset
                </button>
              )}
            </div>
          </Field>
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
          {allPersonas.filter((p) => p.id !== persona.id).length > 0 && (
            <Field label="Visibility">
              <div className="space-y-2">
                <div>
                  <span className="text-neutral-500">Can see responses from:</span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {allPersonas
                      .filter((p) => p.id !== persona.id)
                      .map((other) => {
                        const checked = (visDefs[other.nameSlug] ?? "y") === "y";
                        return (
                          <label key={other.id} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setVisDefs({
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
                    {allPersonas
                      .filter((p) => p.id !== persona.id)
                      .map((other) => {
                        const seenByBase = other.visibilityDefaults[persona.nameSlug] ?? "y";
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
                                setSeenByEdits({
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
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="w-full rounded border border-neutral-300 px-2 py-1 font-mono"
            />
          </Field>
          {error ? <div className="text-red-600">{error}</div> : null}
          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              className="rounded bg-neutral-900 px-2 py-1 text-white hover:bg-neutral-700"
            >
              Save
            </button>
            <button
              onClick={() => void onDelete()}
              className="rounded border border-red-600 px-2 py-1 text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
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
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState<"inherit" | "new">("inherit");
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const [visDefs, setVisDefs] = useState<Record<string, "y" | "n">>({});
  const [seenByEdits, setSeenByEdits] = useState<Record<string, "y" | "n">>({});
  const [error, setError] = useState<string | null>(null);

  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([]);
  const modelListId = "create-model-list";
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const key = PROVIDER_REGISTRY[provider].requiresKey
        ? await keychain.get(PROVIDER_REGISTRY[provider].keychainKey)
        : null;
      const pid = await getSetting(APERTUS_PRODUCT_ID_KEY);
      const infos = await listModelInfos(provider, key, { apertusProductId: pid });
      if (!cancelled) setModelOptions(infos);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, provider]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      const history = useMessagesStore.getState().byConversation[conversationId] ?? [];
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
    const history = useMessagesStore.getState().byConversation[conversationId] ?? [];
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
      <Field label="Name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Alice"
          className="w-full rounded border border-neutral-300 px-2 py-1"
        />
      </Field>
      <Field label="Provider">
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as ProviderId);
            setModel("");
          }}
          className="w-full rounded border border-neutral-300 px-2 py-1"
        >
          {SELECTABLE_PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {/* #141: hosting-country tag prefixes the display name */}
              {formatHostingTag(PROVIDER_REGISTRY[id].hostingCountry)
                ? `${formatHostingTag(PROVIDER_REGISTRY[id].hostingCountry)} ${PROVIDER_REGISTRY[id].displayName}`
                : PROVIDER_REGISTRY[id].displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model override">
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          list={modelListId}
          placeholder={PROVIDER_REGISTRY[provider].defaultModel}
          className="w-full rounded border border-neutral-300 px-2 py-1"
        />
        <datalist id={modelListId}>
          {modelOptions.map((m) => {
            // #141: prefix the model id with the provider's hosting
            // country tag so the data-sovereignty signal stays
            // visible in the picker too.
            const tag = formatHostingTag(PROVIDER_REGISTRY[provider].hostingCountry);
            const tokens = m.maxTokens ? ` — ${formatTokenLimit(m.maxTokens)}` : "";
            return (
              <option key={m.id} value={m.id}>
                {tag ? `${tag} ${m.id}${tokens}` : `${m.id}${tokens}`}
              </option>
            );
          })}
        </datalist>
      </Field>
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
      <Field label="Color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={colorOverride ?? PROVIDER_COLORS[provider]}
            onChange={(e) => setColorOverride(e.target.value)}
            className="h-6 w-8 cursor-pointer rounded border border-neutral-300 p-0"
          />
          <span className="text-neutral-500">
            {colorOverride ? "custom" : "provider default"}
          </span>
          {colorOverride !== null && (
            <button
              type="button"
              onClick={() => setColorOverride(null)}
              className="text-neutral-500 hover:text-neutral-900"
            >
              reset
            </button>
          )}
        </div>
      </Field>
      {personas.length > 0 && (
        <Field label="Visibility">
          <div className="space-y-2">
            <div>
              <span className="text-neutral-500">Can see responses from:</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {personas.map((other) => {
                  const checked = (visDefs[other.nameSlug] ?? "y") === "y";
                  return (
                    <label key={other.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setVisDefs({
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
                {personas.map((other) => {
                  const seenByVal =
                    other.nameSlug in seenByEdits
                      ? (seenByEdits[other.nameSlug] ?? "y")
                      : "y";
                  const checked = seenByVal === "y";
                  return (
                    <label key={other.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSeenByEdits({
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
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="(inherits global)"
          className="w-full rounded border border-neutral-300 px-2 py-1 font-mono"
        />
      </Field>
      {error ? <div className="text-red-600">{error}</div> : null}
      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={!name.trim()}
          className="rounded bg-neutral-900 px-2 py-1 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          Create
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
        >
          Cancel
        </button>
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

