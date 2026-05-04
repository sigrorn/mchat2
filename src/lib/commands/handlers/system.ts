// ------------------------------------------------------------------
// Component: System command handlers
// Responsibility: //vacuum. Operations that affect the database.
//                 (#240: //limitsize removed; per-model context windows
//                 from #261 now drive truncateToFit's enforcement, so
//                 the user-set sliding budget had no remaining purpose.)
// Collaborators: lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import { sql } from "@/lib/tauri/sql";
import type { CommandContext, CommandResult } from "./types";

export async function handleVacuum(ctx: CommandContext): Promise<CommandResult | void> {
  await sql.execute("VACUUM");
  await ctx.deps.appendNotice(ctx.conversation.id, "database vacuumed.");
}
