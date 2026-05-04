// ------------------------------------------------------------------
// Component: Command dispatcher
// Responsibility: Route a ParsedCommand to its domain-specific handler
//                 in lib/commands/handlers/. Keeps the Composer UI
//                 component lean: it invokes dispatchCommand and only
//                 applies the returned CommandResult to its local
//                 text/hint state.
// Collaborators: components/Composer.tsx, lib/commands/handlers/*.
// ------------------------------------------------------------------

import type { ParsedCommand } from "./parseCommand";
import { handleRetry, handlePop, handleEdit } from "./handlers/history";
import { handlePin, handlePins, handleUnpin, handleUnpinAll } from "./handlers/pins";
import { handleSelect, handleSelectAll } from "./handlers/selection";
import {
  handleVisibilityStatus,
  handleVisibility,
  handleVisibilityDefault,
  handleDisplayMode,
} from "./handlers/visibility";
import {
  handleHelp,
  handlePersonas,
  handleActivePrompts,
  handleStats,
  handleVersion,
  handleLog,
} from "./handlers/info";
import { handleAutocompact, handleCompact } from "./handlers/compaction";
import { handleVacuum } from "./handlers/system";
import { handleFork } from "./handlers/fork";
import type { CommandContext, CommandResult } from "./handlers/types";

export type { CommandContext, CommandResult } from "./handlers/types";

export async function dispatchCommand(
  ctx: CommandContext,
  cmd: ParsedCommand,
): Promise<CommandResult | void> {
  switch (cmd.kind) {
    case "noop":
      return;
    case "error":
      await ctx.deps.appendNotice(ctx.conversation.id, cmd.message);
      return { restoreText: ctx.rawInput };
    case "pin":
      return handlePin(ctx, cmd.payload);
    case "pins":
      return handlePins(ctx, cmd.payload);
    case "unpin":
      return handleUnpin(ctx, cmd.payload);
    case "unpinAll":
      return handleUnpinAll(ctx);
    case "edit":
      return handleEdit(ctx, cmd.payload);
    case "pop":
      return handlePop(ctx, cmd.payload);
    case "retry":
      return handleRetry(ctx);
    case "visibility":
      return handleVisibility(ctx, cmd.payload);
    case "visibilityStatus":
      return handleVisibilityStatus(ctx);
    case "visibilityDefault":
      return handleVisibilityDefault(ctx);
    case "displayMode":
      return handleDisplayMode(ctx, cmd.payload);
    case "help":
      return handleHelp(ctx);
    case "personas":
      return handlePersonas(ctx);
    case "activeprompts":
      return handleActivePrompts(ctx);
    case "stats":
      return handleStats(ctx);
    case "version":
      return handleVersion(ctx);
    case "log":
      return handleLog(ctx, cmd.payload);
    case "select":
      return handleSelect(ctx, cmd.payload);
    case "selectAll":
      return handleSelectAll(ctx);
    case "vacuum":
      return handleVacuum(ctx);
    case "autocompact":
      return handleAutocompact(ctx, cmd.payload);
    case "compact":
      return handleCompact(ctx, cmd.payload);
    case "fork":
      return handleFork(ctx, cmd.payload);
  }
}
