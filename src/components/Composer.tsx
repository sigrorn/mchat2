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
import { parseTargetModifiers } from "@/lib/commands/targetModifier";
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
        await runCommand(t, cmd);
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

  const runCommand = async (raw: string, cmd: ReturnType<typeof parseCommand>): Promise<void> => {
    if (cmd.kind === "error") {
      await useMessagesStore.getState().appendNotice(conversation.id, cmd.message);
      setText(raw);
      return;
    }
    if (cmd.kind === "limit") {
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      const floor = conversation.compactionFloorIndex;
      const target = cmd.payload.userNumber;
      if (target === null) {
        // //limit NONE — clear both fixed limit and limitsize.
        // #102: clamp to compaction floor if one exists.
        await useConversationsStore.getState().setLimit(conversation.id, floor);
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
      // #102: clamp to compaction floor.
      const effective = floor !== null && idx < floor ? floor : idx;
      // //limit N clears limitsize (#64 interaction rule).
      await useConversationsStore.getState().setLimit(conversation.id, effective);
      await useConversationsStore.getState().setLimitSize(conversation.id, null);
      return;
    }
    if (cmd.kind === "limitsize") {
      // #64: sliding token budget.
      // #105: using limitsize turns autocompact off.
      if (conversation.autocompactThreshold) {
        await useConversationsStore.getState().setAutocompact(conversation.id, null);
      }
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
    if (cmd.kind === "help") {
      const { formatHelp } = await import("@/lib/commands/help");
      await useMessagesStore.getState().appendNotice(conversation.id, formatHelp());
      return;
    }
    if (cmd.kind === "personas") {
      const { formatPersonasInfo } = await import("@/lib/commands/personasInfo");
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const messages = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      await useMessagesStore.getState().appendNotice(conversation.id, formatPersonasInfo(personas, messages));
      return;
    }
    if (cmd.kind === "version") {
      await useMessagesStore
        .getState()
        .appendNotice(
          conversation.id,
          `mchat2 v${__BUILD_INFO__.version} (${__BUILD_INFO__.commitDate})\ncommit ${__BUILD_INFO__.commitHash}\n${__BUILD_INFO__.commitMessage}`,
        );
      return;
    }
    if (cmd.kind === "stats") {
      const { formatStats } = await import("@/lib/commands/stats");
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const messages = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      await useMessagesStore.getState().appendNotice(conversation.id, formatStats(conversation, messages, personas));
      return;
    }
    if (cmd.kind === "order") {
      const { formatExecutionOrder } = await import("@/lib/commands/executionOrder");
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      await useMessagesStore
        .getState()
        .appendNotice(conversation.id, formatExecutionOrder(personas));
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
    if (cmd.kind === "visibilityDefault") {
      const { buildMatrixFromDefaults } = await import("@/lib/personas/service");
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const matrix = buildMatrixFromDefaults(personas);
      await useConversationsStore.getState().setVisibilityMatrix(conversation.id, matrix);
      await useMessagesStore
        .getState()
        .appendNotice(conversation.id, "visibility: reset to persona defaults.");
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
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      if (cmd.payload.userNumber !== null) {
        // #91: //pop N — rewind to user message N and sequential replay.
        const startIdx = indexByUserNumber(history, cmd.payload.userNumber);
        if (startIdx === null) {
          await useMessagesStore
            .getState()
            .appendNotice(conversation.id, `pop: message ${cmd.payload.userNumber} does not exist.`);
          setText(raw);
          return;
        }
        const userMsgs = history
          .filter((m) => m.role === "user" && !m.pinned && m.index >= startIdx)
          .sort((a, b) => a.index - b.index);
        if (userMsgs.length === 0) {
          await useMessagesStore.getState().appendNotice(conversation.id, "pop: nothing to pop.");
          setText(raw);
          return;
        }
        const queue = userMsgs.map((m) => m.content);
        await messagesRepo.deleteMessagesAfter(conversation.id, startIdx - 1);
        await useMessagesStore.getState().load(conversation.id);
        const first = queue[0] ?? "";
        useMessagesStore.getState().setReplayQueue(conversation.id, queue.slice(1));
        setText(first);
        await useMessagesStore
          .getState()
          .appendNotice(
            conversation.id,
            `rewound to message ${cmd.payload.userNumber}. ${queue.length} user message${queue.length === 1 ? "" : "s"} to replay. Submit empty to skip.`,
          );
        return;
      }
      // //pop (no arg) — drop the last user turn.
      const plan = planPop(history);
      if (!plan.ok) {
        await useMessagesStore.getState().appendNotice(conversation.id, "pop: nothing to pop.");
        setText(raw);
        return;
      }
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
    if (cmd.kind === "unpinAll") {
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
      const pinned = history.filter((m) => m.pinned);
      if (pinned.length === 0) {
        await useMessagesStore.getState().appendNotice(conversation.id, "unpin: no pins to remove.");
        return;
      }
      for (const m of pinned) {
        await useMessagesStore.getState().setPinned(conversation.id, m.id, false);
      }
      await useMessagesStore
        .getState()
        .appendNotice(conversation.id, `unpinned ${pinned.length} message${pinned.length === 1 ? "" : "s"}.`);
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
    if (cmd.kind === "selectAll") {
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const all = personas.map((p) => p.id);
      usePersonasStore.getState().setSelection(conversation.id, all);
      const names = personas.map((p) => p.name).join(", ");
      await useMessagesStore
        .getState()
        .appendNotice(conversation.id, `selected: ${names || "(none)"}.`);
      return;
    }
    if (cmd.kind === "select") {
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const ids: string[] = [];
      const unknown: string[] = [];
      for (const name of cmd.payload.names) {
        const match = personas.find((p) => p.nameSlug === name);
        if (match) {
          if (!ids.includes(match.id)) ids.push(match.id);
        } else {
          unknown.push(name);
        }
      }
      if (unknown.length > 0) {
        await useMessagesStore
          .getState()
          .appendNotice(
            conversation.id,
            `select: unknown persona${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`,
          );
        setText(raw);
        return;
      }
      usePersonasStore.getState().setSelection(conversation.id, ids);
      const names = ids.map((id) => personas.find((p) => p.id === id)?.name ?? id).join(", ");
      await useMessagesStore.getState().appendNotice(conversation.id, `selected: ${names}.`);
      return;
    }
    if (cmd.kind === "vacuum") {
      const { sql } = await import("@/lib/tauri/sql");
      await sql.execute("VACUUM");
      await useMessagesStore.getState().appendNotice(conversation.id, "database vacuumed.");
      return;
    }
    if (cmd.kind === "autocompact") {
      const { payload } = cmd;
      if (payload.mode === "off") {
        await useConversationsStore.getState().setAutocompact(conversation.id, null);
        await useMessagesStore.getState().appendNotice(conversation.id, "autocompact: off.");
        return;
      }
      // Disable limitsize when autocompact is turned on (#105).
      if (conversation.limitSizeTokens !== null) {
        await useConversationsStore.getState().setLimitSize(conversation.id, null);
      }
      const threshold: import("@/lib/types").AutocompactThreshold = {
        mode: payload.mode,
        value: payload.value,
        ...(payload.preserve !== undefined && payload.preserve > 0
          ? { preserve: payload.preserve }
          : {}),
      };
      await useConversationsStore.getState().setAutocompact(conversation.id, threshold);
      const label =
        payload.mode === "kTokens"
          ? `${payload.value}k tokens`
          : `${payload.value}% of tightest model`;
      const preserveSuffix =
        threshold.preserve && threshold.preserve > 0
          ? ` (preserving last ${threshold.preserve} user message${threshold.preserve === 1 ? "" : "s"})`
          : "";
      await useMessagesStore
        .getState()
        .appendNotice(
          conversation.id,
          `autocompact: will compact when context exceeds ${label}${preserveSuffix}. limitsize cleared.`,
        );
      return;
    }
    if (cmd.kind === "compact") {
      const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      if (personas.length === 0) {
        await useMessagesStore
          .getState()
          .appendNotice(conversation.id, "compact: no personas to compact.");
        return;
      }
      const { runCompaction, formatPersonaLine } = await import(
        "@/lib/conversations/runCompaction"
      );
      const preserve = cmd.payload.preserve;
      const preserveLabel =
        preserve > 0 ? ` (preserving last ${preserve} user message${preserve === 1 ? "" : "s"})` : "";
      await useMessagesStore
        .getState()
        .appendNotice(
          conversation.id,
          `compacting: generating summaries for ${personas.length} persona${personas.length === 1 ? "" : "s"}${preserveLabel}…`,
        );
      const result = await runCompaction(conversation, personas, preserve, {
        onPersonaStart: (pid) =>
          useSendStore.getState().setTargetStatus(conversation.id, pid, "streaming"),
        onPersonaError: (pid) =>
          useSendStore.getState().setTargetStatus(conversation.id, pid, "retrying"),
        onPersonaDone: (pid) => useSendStore.getState().clearTargetStatus(conversation.id, pid),
      });
      for (const f of result.failures) {
        await useMessagesStore
          .getState()
          .appendNotice(conversation.id, `compact: failed for ${f.persona.name}: ${f.error}`);
      }
      if (result.nothingToDo) {
        await useMessagesStore
          .getState()
          .appendNotice(
            conversation.id,
            `compact: nothing to compact (preserve ${preserve} already covers the full unexcluded history).`,
          );
        return;
      }
      if (result.summaries.length === 0) {
        await useMessagesStore
          .getState()
          .appendNotice(conversation.id, "compact: no summaries generated.");
        return;
      }
      await useMessagesStore.getState().load(conversation.id);
      await useConversationsStore
        .getState()
        .setCompactionFloor(conversation.id, result.cutoff);
      await useConversationsStore
        .getState()
        .setLimit(conversation.id, result.cutoff);
      const lines = [
        `compacted ${result.summaries.length} persona${result.summaries.length === 1 ? "" : "s"}.`,
      ];
      for (const s of result.summaries) {
        lines.push(formatPersonaLine(s, result.tightestMaxTokens));
      }
      await useMessagesStore.getState().appendNotice(conversation.id, lines.join("\n"));
      return;
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
