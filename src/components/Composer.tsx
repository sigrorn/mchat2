// ------------------------------------------------------------------
// Component: Composer
// Responsibility: Text area + send/cancel buttons. Parses commands
//                 and delegates to lib/commands/dispatch.ts (#114).
//                 Plain-text input flows through useSend.
// ------------------------------------------------------------------

import { useState } from "react";
import type { Conversation, Persona } from "@/lib/types";
import { useSend } from "@/hooks/useSend";
import { useSendStore, type ActiveStream } from "@/stores/sendStore";
import { useMessagesStore } from "@/stores/messagesStore";
import { parseCommand } from "@/lib/commands/parseCommand";
import { parseTargetModifiers } from "@/lib/commands/targetModifier";
import { dispatchCommand } from "@/lib/commands/dispatch";
import { makeCommandDeps } from "@/hooks/commandDeps";
import { usePersonasStore } from "@/stores/personasStore";
import { shouldSubmit } from "./composerKeys";
import { buildPlaceholder } from "@/lib/ui/composerPlaceholder";
import { PrimaryButton, DangerButton } from "@/components/ui/Button";

const EMPTY_ACTIVE: readonly ActiveStream[] = Object.freeze([]);
const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);
const EMPTY_SEL: readonly string[] = Object.freeze([]);

export function Composer({ conversation }: { conversation: Conversation }): JSX.Element {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const { send, retry } = useSend(conversation);
  const active = useSendStore((s) => s.activeByConversation[conversation.id]) ?? EMPTY_ACTIVE;
  const cPersonas = usePersonasStore((s) => s.byConversation[conversation.id]) ?? EMPTY_PERSONAS;
  const cSelection =
    usePersonasStore((s) => s.selectionByConversation[conversation.id]) ?? EMPTY_SEL;
  const placeholder = buildPlaceholder(cPersonas, cSelection);

  const applyResult = (
    raw: string,
    result: { restoreText?: string; hint?: string } | void,
  ): void => {
    if (!result) return;
    if (result.restoreText !== undefined) setText(result.restoreText);
    if (result.hint !== undefined) setHint(result.hint);
    // Parameter `raw` kept for symmetry; currently unused unless handler
    // doesn't supply restoreText but caller wants to restore.
    void raw;
  };

  const onSend = async (): Promise<void> => {
    const hasQueue = (useMessagesStore.getState().replayQueue[conversation.id]?.length ?? 0) > 0;
    if (!text.trim() && !hasQueue) return;
    if (busy) return;
    // #91: empty submit during replay queue = skip this message.
    if (!text.trim() && hasQueue) {
      const next = useMessagesStore.getState().popReplayQueue(conversation.id);
      if (next !== null) {
        setText(next);
      } else {
        setText("");
      }
      return;
    }
    setBusy(true);
    setHint(null);
    const t = text;
    setText("");
    try {
      const cmd = parseCommand(t);
      if (cmd.kind !== "noop") {
        const result = await dispatchCommand(
          { conversation, rawInput: t, send, retry, deps: makeCommandDeps() },
          cmd,
        );
        applyResult(t, result);
        return;
      }
      // #96: +/- target modifier shortcuts.
      const modResult = await tryTargetModifiers(t, conversation.id);
      if (modResult) return;

      const result = await send(t);
      if (!result.ok) {
        setText(t);
        setHint(
          result.reason === "no targets"
            ? "No persona selected. Use @name (or @all) to address one, then it stays sticky for follow-ups."
            : `Could not send: ${result.reason}`,
        );
      } else {
        const next = useMessagesStore.getState().popReplayQueue(conversation.id);
        if (next !== null) setText(next);
      }
    } finally {
      setBusy(false);
    }
  };

  // #96: +/- target modifiers — add/remove personas from selection.
  const tryTargetModifiers = async (
    input: string,
    conversationId: string,
  ): Promise<boolean> => {
    const parsed = parseTargetModifiers(input);
    if (!parsed.ok) return false;
    const personas = usePersonasStore.getState().byConversation[conversationId] ?? [];
    const current = usePersonasStore.getState().selectionByConversation[conversationId] ?? [];
    let selection = [...current];
    const errors: string[] = [];
    for (const op of parsed.ops) {
      const match = personas.find((p) => p.nameSlug === op.name);
      if (!match) {
        errors.push(`unknown persona: ${op.name}`);
        continue;
      }
      if (op.action === "add") {
        if (!selection.includes(match.id)) selection.push(match.id);
      } else {
        const without = selection.filter((id) => id !== match.id);
        if (without.length === 0) {
          errors.push("cannot remove the last target");
          continue;
        }
        selection = without;
      }
    }
    if (errors.length > 0) {
      setHint(errors.join("; "));
      setText(input);
      return true;
    }
    usePersonasStore.getState().setSelection(conversationId, selection);
    const names = selection
      .map((id) => personas.find((p) => p.id === id)?.name ?? id)
      .join(", ");
    await useMessagesStore.getState().appendNotice(conversationId, `selected: ${names}.`);
    return true;
  };

  const onCancel = (): void => {
    useSendStore.getState().cancelAll(conversation.id);
  };

  return (
    <div className="flex-1 p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (shouldSubmit(e)) {
            e.preventDefault();
            void onSend();
          }
        }}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-y rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
      />
      {hint ? <div className="mt-2 text-xs text-amber-700">{hint}</div> : null}
      <div className="mt-2 flex gap-2">
        <PrimaryButton onClick={() => void onSend()} disabled={busy || !text.trim()}>
          Send
        </PrimaryButton>
        {active.length > 0 ? <DangerButton onClick={onCancel}>Cancel</DangerButton> : null}
      </div>
    </div>
  );
}
