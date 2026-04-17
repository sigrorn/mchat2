// ------------------------------------------------------------------
// Component: Composer
// Responsibility: Text area + send/cancel buttons. Delegates all send
//                 logic to useSend.
// ------------------------------------------------------------------

import { useState } from "react";
import type { Conversation } from "@/lib/types";
import { useSend } from "@/hooks/useSend";
import { useSendStore, type ActiveStream } from "@/stores/sendStore";
import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { parseCommand } from "@/lib/commands/parseCommand";
import { indexByUserNumber, userMessageCount } from "@/lib/conversations/userMessageNumber";
import { resolveEditTarget } from "@/lib/conversations/resolveEditTarget";
import { planPop } from "@/lib/conversations/popPlan";
import { findFailedRowsInLastGroup } from "@/lib/orchestration/findFailedRowsInLastGroup";
import * as messagesRepo from "@/lib/persistence/messages";
import { formatPinsNotice } from "@/lib/conversations/pinFormatter";
import { usePersonasStore } from "@/stores/personasStore";
import { shouldSubmit } from "./composerKeys";
import { useUiStore } from "@/stores/uiStore";
import { buildPlaceholder } from "@/lib/ui/composerPlaceholder";
import type { Persona } from "@/lib/types";

const EMPTY_ACTIVE: readonly ActiveStream[] = Object.freeze([]);
const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);
const EMPTY_SEL: readonly string[] = Object.freeze([]);

export function Composer({ conversation }: { conversation: Conversation }): JSX.Element {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const { send, retry } = useSend(conversation);
  const active = useSendStore((s) => s.activeByConversation[conversation.id]) ?? EMPTY_ACTIVE;
  const fontScale = useUiStore((s) => s.chatFontScale);
  const cPersonas = usePersonasStore((s) => s.byConversation[conversation.id]) ?? EMPTY_PERSONAS;
  const cSelection =
    usePersonasStore((s) => s.selectionByConversation[conversation.id]) ?? EMPTY_SEL;
  const placeholder = buildPlaceholder(cPersonas, cSelection);

  const onSend = async (): Promise<void> => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setHint(null);
    const t = text;
    setText("");
    try {
      // Intercept in-app commands BEFORE the send pipeline. Commands
      // never reach an LLM and never become user-role rows.
      const cmd = parseCommand(t);
      if (cmd.kind !== "noop") {
        await runCommand(t, cmd);
        return;
      }
      const result = await send(t);
      if (!result.ok) {
        setText(t);
        setHint(
          result.reason === "no targets"
            ? "No persona selected. Use @name (or @all) to address one, then it stays sticky for follow-ups."
            : `Could not send: ${result.reason}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const runCommand = async (raw: string, cmd: ReturnType<typeof parseCommand>): Promise<void> => {
    if (cmd.kind === "error") {
      await useMessagesStore.getState().appendNotice(conversation.id, cmd.message);
      setText(raw);
      return;
    }
    if (cmd.kind === "limit") {
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      const target = cmd.payload.userNumber;
      if (target === null) {
        // //limit NONE — clear both fixed limit and limitsize.
        await useConversationsStore.getState().setLimit(conversation.id, null);
        await useConversationsStore.getState().setLimitSize(conversation.id, null);
        return;
      }
      if (target === 0) {
        // #51: //limit 0 — hide every current message. Set the mark
        // to one past the last index so rule 3 of buildContext
        // filters them all (pinned rows still survive). New messages
        // appended after this point sit above the mark naturally.
        const maxIdx = history.reduce((m, msg) => Math.max(m, msg.index), -1);
        await useConversationsStore.getState().setLimit(conversation.id, maxIdx + 1);
        return;
      }
      const idx = indexByUserNumber(history, target);
      if (idx === null) {
        const total = userMessageCount(history);
        await useMessagesStore
          .getState()
          .appendNotice(
            conversation.id,
            `limit: message ${target} does not exist (conversation has ${total} user message${total === 1 ? "" : "s"}).`,
          );
        setText(raw);
        return;
      }
      // //limit N clears limitsize (#64 interaction rule).
      await useConversationsStore.getState().setLimit(conversation.id, idx);
      await useConversationsStore.getState().setLimitSize(conversation.id, null);
      return;
    }
    if (cmd.kind === "limitsize") {
      // #64: sliding token budget.
      const kTokens = cmd.payload.kTokens;
      if (kTokens === 0) {
        await useConversationsStore.getState().setLimitSize(conversation.id, null);
        await useMessagesStore.getState().appendNotice(conversation.id, "limitsize: cleared.");
        return;
      }
      if (kTokens !== null) {
        await useConversationsStore.getState().setLimitSize(conversation.id, kTokens * 1000);
        await useMessagesStore
          .getState()
          .appendNotice(
            conversation.id,
            `limitsize: set to ${kTokens}k tokens. Context will be trimmed per provider.`,
          );
        return;
      }
      // kTokens === null → auto-fit to tightest provider.
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      if (personas.length === 0) {
        await useMessagesStore
          .getState()
          .appendNotice(conversation.id, "limitsize: no personas — nothing to fit.");
        setText(raw);
        return;
      }
      const { tightestBudgetNotice } = await import("@/lib/commands/limitsizeNotice");
      const notice = tightestBudgetNotice(personas);
      if (!notice) {
        await useMessagesStore
          .getState()
          .appendNotice(conversation.id, "limitsize: all providers have unlimited context.");
        return;
      }
      const { PROVIDER_REGISTRY } = await import("@/lib/providers/registry");
      const tightest = Math.min(
        ...personas.map((p) => PROVIDER_REGISTRY[p.provider].maxContextTokens),
      );
      await useConversationsStore.getState().setLimitSize(conversation.id, tightest);
      await useMessagesStore.getState().appendNotice(conversation.id, notice);
      return;
    }
    if (cmd.kind === "pin") {
      // Reuse the resolver via useSend with pinned=true. Reject @others
      // up-front since it's contextual and pins need a stable audience.
      if (/^\s*@others\b/i.test(cmd.payload.rest)) {
        await useMessagesStore
          .getState()
          .appendNotice(
            conversation.id,
            "pin: @others is not allowed — pins need an explicit, stable audience. Use @name or @all.",
          );
        setText(raw);
        return;
      }
      const r = await send(cmd.payload.rest, { pinned: true });
      if (!r.ok) {
        await useMessagesStore
          .getState()
          .appendNotice(
            conversation.id,
            r.reason === "no targets"
              ? "pin: specify the target persona(s) before the message body. e.g. //pin @claudio do this."
              : `pin: could not send (${r.reason}).`,
          );
        setText(raw);
      }
      return;
    }
    if (cmd.kind === "pins") {
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const body = formatPinsNotice(history, personas, cmd.payload.persona);
      if (body === null) {
        await useMessagesStore
          .getState()
          .appendNotice(conversation.id, `pins: persona '${cmd.payload.persona ?? ""}' not found.`);
        setText(raw);
        return;
      }
      await useMessagesStore.getState().appendNotice(conversation.id, body);
      return;
    }
    if (cmd.kind === "visibilityStatus") {
      const { formatVisibilityStatus } = await import("@/lib/commands/visibilityStatus");
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const notice = formatVisibilityStatus(conversation.visibilityMatrix, personas);
      await useMessagesStore.getState().appendNotice(conversation.id, notice);
      return;
    }
    if (cmd.kind === "visibility") {
      // #52: //visibility separated|joined applies the preset matrix
      // to every current persona and updates visibilityMode.
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const personaIds = personas.map((p) => p.id);
      await useConversationsStore
        .getState()
        .setVisibilityPreset(conversation.id, cmd.payload.mode, personaIds);
      await useMessagesStore
        .getState()
        .appendNotice(
          conversation.id,
          `visibility: switched to ${cmd.payload.mode === "joined" ? "full" : cmd.payload.mode}.`,
        );
      return;
    }
    if (cmd.kind === "displayMode") {
      await useConversationsStore.getState().setDisplayMode(conversation.id, cmd.payload.mode);
      await useMessagesStore
        .getState()
        .appendNotice(conversation.id, `display: switched to ${cmd.payload.mode}.`);
      return;
    }
    if (cmd.kind === "retry") {
      // #49: batch-retry every failed assistant row in the last send
      // group in parallel. Reuses #43's per-row retry machinery to
      // create a fresh streamed row; the old failed row is then
      // deleted so the final view shows only the successful retries.
      // (Matches old mchat's morph-in-place outcome without requiring
      // streamRunner to update existing rows.)
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      const failed = findFailedRowsInLastGroup(history);
      if (failed.length === 0) {
        await useMessagesStore.getState().appendNotice(conversation.id, "retry: nothing to retry.");
        setText(raw);
        return;
      }
      const cleanupIds: string[] = [];
      await Promise.all(
        failed.map(async (m) => {
          const r = await retry(m);
          if (r.ok) cleanupIds.push(m.id);
        }),
      );
      for (const id of cleanupIds) {
        await messagesRepo.deleteMessage(id);
      }
      if (cleanupIds.length > 0) await useMessagesStore.getState().load(conversation.id);
      return;
    }
    if (cmd.kind === "pop") {
      // #48: drop the last user turn + every following row, restore
      // the user message's text to the Composer so the user can edit
      // and re-send manually. Destructive on purpose — //edit is the
      // non-destructive variant (hides, regenerates automatically).
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      const plan = planPop(history);
      if (!plan.ok) {
        await useMessagesStore.getState().appendNotice(conversation.id, "pop: nothing to pop.");
        setText(raw);
        return;
      }
      // Truncate at lastUserIndex - 1 (deleteMessagesAfter keeps the
      // index strictly > arg, so -1 includes the user row itself).
      await messagesRepo.deleteMessagesAfter(conversation.id, plan.lastUserIndex - 1);
      await useMessagesStore.getState().load(conversation.id);
      setText(plan.restoredText);
      await useMessagesStore
        .getState()
        .appendNotice(
          conversation.id,
          `popped ${plan.deleteIds.length} message${plan.deleteIds.length === 1 ? "" : "s"}.`,
        );
      return;
    }
    if (cmd.kind === "edit") {
      // #47: target the specified user message and open MessageList's
      // inline editor — same UI as clicking the per-row 'edit' button
      // (#44). Routes through messagesStore.setEditing so the trigger
      // doesn't need a local ref between components.
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      const target = resolveEditTarget(history, cmd.payload.userNumber);
      if (!target) {
        const total = userMessageCount(history);
        const label = cmd.payload.userNumber ?? "last";
        await useMessagesStore
          .getState()
          .appendNotice(
            conversation.id,
            total === 0
              ? "edit: no user message to edit."
              : `edit: message ${label} does not exist (conversation has ${total} user message${total === 1 ? "" : "s"}).`,
          );
        setText(raw);
        return;
      }
      useMessagesStore.getState().setEditing(conversation.id, target.id);
      return;
    }
    if (cmd.kind === "unpin") {
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      const idx = indexByUserNumber(history, cmd.payload.userNumber);
      if (idx === null) {
        await useMessagesStore
          .getState()
          .appendNotice(
            conversation.id,
            `unpin: message ${cmd.payload.userNumber} does not exist.`,
          );
        setText(raw);
        return;
      }
      const target = history.find((m) => m.index === idx);
      if (!target?.pinned) {
        await useMessagesStore
          .getState()
          .appendNotice(conversation.id, `unpin: message ${cmd.payload.userNumber} is not pinned.`);
        setText(raw);
        return;
      }
      await useMessagesStore.getState().setPinned(conversation.id, target.id, false);
      await useMessagesStore
        .getState()
        .appendNotice(conversation.id, `unpinned message ${cmd.payload.userNumber}.`);
      return;
    }
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
        style={{ fontSize: `${fontScale * 100}%` }}
      />
      {hint ? <div className="mt-2 text-xs text-amber-700">{hint}</div> : null}
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void onSend()}
          disabled={busy || !text.trim()}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          Send
        </button>
        {active.length > 0 ? (
          <button
            onClick={onCancel}
            className="rounded border border-red-600 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
