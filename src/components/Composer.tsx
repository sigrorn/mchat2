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
import { formatPinsNotice } from "@/lib/conversations/pinFormatter";
import { usePersonasStore } from "@/stores/personasStore";
import { useUiStore } from "@/stores/uiStore";
import { shouldSubmit } from "./composerKeys";
import { useEffect } from "react";

const EMPTY_ACTIVE: readonly ActiveStream[] = Object.freeze([]);

export function Composer({ conversation }: { conversation: Conversation }): JSX.Element {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const { send } = useSend(conversation);
  const active =
    useSendStore((s) => s.activeByConversation[conversation.id]) ?? EMPTY_ACTIVE;
  // #32: Surface Stronghold unlocks (cold start is slow) in the hint
  // line. Delay rendering by 300ms so a fast (cached) unlock doesn't
  // flash the line and flicker the layout.
  const keychainBusy = useUiStore((s) => s.keychainBusy);
  const [unlocking, setUnlocking] = useState(false);
  useEffect(() => {
    if (keychainBusy > 0) {
      const t = setTimeout(() => setUnlocking(true), 300);
      return () => clearTimeout(t);
    }
    setUnlocking(false);
    return;
  }, [keychainBusy]);

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

  const runCommand = async (
    raw: string,
    cmd: ReturnType<typeof parseCommand>,
  ): Promise<void> => {
    if (cmd.kind === "error") {
      await useMessagesStore.getState().appendNotice(conversation.id, cmd.message);
      setText(raw);
      return;
    }
    if (cmd.kind === "limit") {
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      const target = cmd.payload.userNumber;
      if (target === null) {
        // //limit ALL — clear the limit.
        await useConversationsStore.getState().setLimit(conversation.id, null);
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
      await useConversationsStore.getState().setLimit(conversation.id, idx);
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
          .appendNotice(
            conversation.id,
            `pins: persona '${cmd.payload.persona ?? ""}' not found.`,
          );
        setText(raw);
        return;
      }
      await useMessagesStore.getState().appendNotice(conversation.id, body);
      return;
    }
    if (cmd.kind === "displayMode") {
      await useConversationsStore
        .getState()
        .setDisplayMode(conversation.id, cmd.payload.mode);
      await useMessagesStore
        .getState()
        .appendNotice(
          conversation.id,
          `display: switched to ${cmd.payload.mode}.`,
        );
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
          .appendNotice(
            conversation.id,
            `unpin: message ${cmd.payload.userNumber} is not pinned.`,
          );
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
    <div className="border-t border-neutral-200 p-3">
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
        placeholder="Type a message. Use @alice @all @others to target personas. Enter to send, Shift+Enter for newline."
        className="w-full resize-y rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
      />
      {hint ? (
        <div className="mt-2 text-xs text-amber-700">{hint}</div>
      ) : unlocking ? (
        <div className="mt-2 text-xs text-amber-700">Unlocking secure storage…</div>
      ) : null}
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
