// ------------------------------------------------------------------
// Component: Compaction command handlers
// Responsibility: //compact, //autocompact. Manual compaction runs
//                 the shared runCompaction; autocompact configures
//                 the per-conversation threshold that postResponseCheck
//                 monitors.
// Collaborators: lib/commands/dispatch.ts,
//                lib/conversations/runCompaction.ts.
// ------------------------------------------------------------------

import type { AutocompactThreshold } from "@/lib/types";
import { runCompaction, formatPersonaLine } from "@/lib/conversations/runCompaction";
import { formatStats } from "@/lib/commands/stats";
import { transaction } from "@/lib/persistence/transaction";
import type { CommandContext, CommandResult } from "./types";

export async function handleAutocompact(
  ctx: CommandContext,
  payload:
    | { mode: "kTokens"; value: number; preserve?: number }
    | { mode: "percent"; value: number; preserve?: number }
    | { mode: "off" },
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  if (payload.mode === "off") {
    await ctx.deps.setAutocompact(conversation.id, null);
    await ctx.deps.appendNotice(conversation.id, "autocompact: off.");
    return;
  }
  // #240: prior to limitsize removal, this block also cleared
  // conversation.limitSizeTokens when autocompact was enabled (#105
  // interaction rule). limitsize is gone; nothing to clear.
  const threshold: AutocompactThreshold = {
    mode: payload.mode,
    value: payload.value,
    ...(payload.preserve !== undefined && payload.preserve > 0
      ? { preserve: payload.preserve }
      : {}),
  };
  await ctx.deps.setAutocompact(conversation.id, threshold);
  const label =
    payload.mode === "kTokens"
      ? `${payload.value}k tokens`
      : `${payload.value}% of tightest model`;
  const preserveSuffix =
    threshold.preserve && threshold.preserve > 0
      ? ` (preserving last ${threshold.preserve} user message${threshold.preserve === 1 ? "" : "s"})`
      : "";
  await ctx.deps.appendNotice(
    conversation.id,
    `autocompact: will compact when context exceeds ${label}${preserveSuffix}. limitsize cleared.`,
  );
}

export async function handleCompact(
  ctx: CommandContext,
  payload: { preserve: number },
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = ctx.deps.getPersonas(conversation.id);
  if (personas.length === 0) {
    await ctx.deps.appendNotice(conversation.id, "compact: no personas to compact.");
    return;
  }
  const preserve = payload.preserve;
  const preserveLabel =
    preserve > 0 ? ` (preserving last ${preserve} user message${preserve === 1 ? "" : "s"})` : "";
  // #122 — emit the current //stats snapshot before compacting so the
  // user can see the TTFT/throughput averages that led up to this run.
  const preMessages = ctx.deps.getMessages(conversation.id);
  await ctx.deps.appendNotice(
    conversation.id,
    formatStats(conversation, [...preMessages], [...personas]),
  );
  await ctx.deps.appendNotice(
    conversation.id,
    `compacting: generating summaries for ${personas.length} persona${personas.length === 1 ? "" : "s"}${preserveLabel}…`,
  );
  const result = await runCompaction(conversation, [...personas], preserve, {
    // #123 — use "compacting" status (pale brown) instead of the
    // regular "streaming" yellow, so the persona panel makes clear
    // that a compaction is in progress rather than a normal reply.
    onPersonaStart: (pid) => ctx.deps.setTargetStatus(conversation.id, pid, "compacting"),
    onPersonaError: (pid) => ctx.deps.setTargetStatus(conversation.id, pid, "retrying"),
    onPersonaDone: (pid) => ctx.deps.clearTargetStatus(conversation.id, pid),
  });
  for (const f of result.failures) {
    await ctx.deps.appendNotice(
      conversation.id,
      `compact: failed for ${f.persona.name}: ${f.error}`,
    );
  }
  if (result.nothingToDo) {
    await ctx.deps.appendNotice(
      conversation.id,
      `compact: nothing to compact (preserve ${preserve} already covers the full unexcluded history).`,
    );
    return;
  }
  if (result.summaries.length === 0) {
    await ctx.deps.appendNotice(conversation.id, "compact: no summaries generated.");
    return;
  }
  await ctx.deps.reloadMessages(conversation.id);
  // #240: limit_mark_index column dropped along with //limit. Compaction
  // now only moves the floor. (#164's transaction is preserved as a
  // single-write to keep the rollback semantics stable.)
  await transaction(async () => {
    await ctx.deps.setCompactionFloor(conversation.id, result.cutoff);
  });
  const lines = [
    `compacted ${result.summaries.length} persona${result.summaries.length === 1 ? "" : "s"}.`,
  ];
  for (const s of result.summaries) {
    lines.push(formatPersonaLine(s, result.tightestMaxTokens));
  }
  await ctx.deps.appendNotice(conversation.id, lines.join("\n"));
}
