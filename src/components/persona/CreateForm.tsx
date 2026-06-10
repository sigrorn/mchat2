// ------------------------------------------------------------------
// Component: CreateForm
// Responsibility: The "+ Add persona" create form plus the Import /
//                 Export buttons. Extracted from PersonaPanel.tsx in
//                 #319. Owns its own draft state; calls onCreated for
//                 each persona it produces (create or import).
// Collaborators: PersonaFormFields, personas/service + fileOps +
//                identityPin, messagesStore, uiStore.
// ------------------------------------------------------------------

import { useState } from "react";
import type { Flow, Persona, ProviderId } from "@/lib/types";
import { userSelectableProviderIds } from "@/lib/providers/userSelectable";
import {
  createPersona,
  applySeenByEdits,
  PersonaValidationError,
} from "@/lib/personas/service";
import { exportPersonasToFile, importPersonasFromFile } from "@/lib/personas/fileOps";
import { ensureIdentityPinTopLevel } from "@/lib/personas/identityPin";
import { readCachedMessages } from "@/hooks/cacheReaders";
import { useMessagesStore } from "@/stores/messagesStore";
import { useUiStore } from "@/stores/uiStore";
import { OutlineButton, PrimaryButton } from "@/components/ui/Button";
import { useModelOptions } from "../useModelOptions";
import { PersonaFormFields } from "../PersonaFormFields";

const SELECTABLE_PROVIDER_IDS = userSelectableProviderIds(import.meta.env.DEV);
const DEFAULT_NEW_PROVIDER: ProviderId = SELECTABLE_PROVIDER_IDS[0] ?? "claude";

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

export function CreateForm({
  conversationId,
  conversationTitle,
  personas,
  flow,
  onCreated,
}: {
  conversationId: string;
  conversationTitle: string;
  personas: readonly Persona[];
  // #236: passed through so onExport can bundle the flow.
  flow: Flow | null;
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
      // #260: createdAtMessageIndex is now always history.length —
      // the actual join point. The "inherit" semantics are carried
      // by inheritedHistory, which exempts this persona from the
      // addressedTo / audience filters for pre-creation messages.
      const currentIdx = history.length;
      const p = await createPersona({
        conversationId,
        provider,
        name,
        currentMessageIndex: currentIdx,
        inheritedHistory: scope === "inherit",
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
      await ensureIdentityPinTopLevel(conversationId, p, history, scopeInfo);
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
    // #236: bundle the conversation's flow when one is attached so a
    // shared persona kit (e.g. an NVC setup) round-trips with the
    // step ordering + per-persona roleLens that make it actually work.
    const r = await exportPersonasToFile(
      conversationTitle,
      personas,
      useUiStore.getState().workingDir,
      flow,
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
