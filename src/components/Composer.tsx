// ------------------------------------------------------------------
// Component: Composer
// Responsibility: Text area + send/cancel buttons. Parses commands
//                 and delegates to lib/commands/dispatch.ts (#114).
//                 Plain-text input flows through useSend.
// ------------------------------------------------------------------

import { useLayoutEffect, useRef, useState } from "react";
import type { Conversation, Flow, Persona } from "@/lib/types";
import { useSend } from "@/hooks/useSend";
import { useSendStore, type ActiveStream } from "@/stores/sendStore";
import { useMessagesStore } from "@/stores/messagesStore";
import { parseCommand } from "@/lib/commands/parseCommand";
import { parseTargetModifiers } from "@/lib/commands/targetModifier";
import { dispatchCommand } from "@/lib/commands/dispatch";
import { findSpec } from "@/lib/commands/specs";
import { triggerHelp } from "@/lib/commands/triggerHelp";
import { makeCommandDeps } from "@/hooks/commandDeps";
import { usePersonasStore } from "@/stores/personasStore";
import { readCachedPersonas } from "@/hooks/cacheReaders";
import { useRepoQuery } from "@/lib/data/useRepoQuery";
import * as personasRepo from "@/lib/persistence/personas";
import * as flowsRepo from "@/lib/persistence/flows";
import {
  applyCompletion,
  candidatesFor,
  tokenAtCursor,
  type CompletionToken,
} from "@/lib/composer/complete";
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
  const personasQuery = useRepoQuery<Persona[]>(
    ["personas", conversation.id],
    () => personasRepo.listPersonas(conversation.id),
  );
  const cPersonas = personasQuery.data ?? EMPTY_PERSONAS;
  // #238: flow attachment is read for the autocomplete sources object
  // (currently @convo is always offered regardless, but the field is
  // future-proofed). Cheap query — repoQuery deduplicates with the
  // same key the panel uses.
  const flowQuery = useRepoQuery<Flow | null>(
    ["flow", conversation.id],
    () => flowsRepo.getFlow(conversation.id),
  );
  const flow = flowQuery.data ?? null;
  const cSelection =
    usePersonasStore((s) => s.selectionByConversation[conversation.id]) ?? EMPTY_SEL;
  const placeholder = buildPlaceholder(cPersonas, cSelection);

  // #238: tab-completion state. textareaRef is needed for caret
  // restoration after a cycle step rewrites the controlled value.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cycleRef = useRef<{
    baseInput: string;
    baseRange: { start: number; end: number };
    candidates: string[];
    cycleIndex: number;
    appendSpaceOnComplete: boolean;
  } | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const target = pendingCaretRef.current;
    if (target === null) return;
    pendingCaretRef.current = null;
    const ta = textareaRef.current;
    if (ta) {
      ta.selectionStart = target;
      ta.selectionEnd = target;
    }
  }, [text]);

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
    const personas = readCachedPersonas(conversationId);
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

  // #238: Tab handler. Cycles through completion candidates for the
  // token under the cursor; falls through to the browser default
  // (focus-leave) when nothing applicable is on screen.
  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget;
    const cursor = ta.selectionStart ?? text.length;

    // Active cycle? Step it forward / backward.
    if (cycleRef.current !== null) {
      const c = cycleRef.current;
      const delta = e.shiftKey ? -1 : 1;
      const nextIndex = (c.cycleIndex + delta + c.candidates.length) % c.candidates.length;
      e.preventDefault();
      const r = applyCompletion(
        c.baseInput,
        c.baseRange,
        c.candidates[nextIndex]!,
        { appendSpaceOnComplete: c.appendSpaceOnComplete },
      );
      pendingCaretRef.current = r.cursor;
      setText(r.text);
      cycleRef.current = { ...c, cycleIndex: nextIndex };
      return;
    }

    const token = tokenAtCursor(text, cursor);

    // #238: //<TAB> with empty verb → fire help via the shared
    // triggerHelp dedup. Composer text stays as // so the user can
    // keep typing if they actually wanted a verb.
    if (token.kind === "command" && token.prefix === "") {
      e.preventDefault();
      void triggerHelp(makeCommandDeps(), conversation.id);
      return;
    }

    if (token.kind === "none") return; // pass through — Tab leaves the field.

    const candidates = candidatesFor(token, {
      personas: cPersonas.map((p) => ({ id: p.id, nameSlug: p.nameSlug })),
      flowAttached: flow !== null,
    });
    if (candidates.length === 0) return; // no dead key — let Tab leave.

    // Pick the spec's appendSpaceOnComplete setting for command tokens;
    // for targets / selection modifiers, default to true.
    const appendSpace = (() => {
      if (token.kind !== "command") return true;
      const verb = candidates[0]!.replace(/^\/\//, "");
      return findSpec(verb)?.completion?.appendSpaceOnComplete ?? false;
    })();

    e.preventDefault();
    const r = applyCompletion(text, token.range, candidates[0]!, {
      appendSpaceOnComplete: appendSpace,
    });
    pendingCaretRef.current = r.cursor;
    setText(r.text);
    cycleRef.current = {
      baseInput: text,
      baseRange: token.range,
      candidates,
      cycleIndex: 0,
      appendSpaceOnComplete: appendSpace,
    };
  };
  void (null as unknown as CompletionToken); // keep import in case of future refactors

  return (
    <div className="flex-1 p-3">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          // Any direct edit resets the completion cycle.
          cycleRef.current = null;
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (shouldSubmit(e)) {
            e.preventDefault();
            void onSend();
            return;
          }
          if (e.key === "Tab" && !e.nativeEvent.isComposing) {
            handleTab(e);
            return;
          }
          // Any other key resets the cycle (next Tab starts fresh).
          if (cycleRef.current !== null) cycleRef.current = null;
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
