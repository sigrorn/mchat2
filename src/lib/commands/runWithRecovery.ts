// ------------------------------------------------------------------
// Component: runWithRecovery
// Responsibility: Wrap a command dispatch so a thrown error becomes a
//                 CommandResult instead of an unhandled rejection. The
//                 Composer cleared the textarea before awaiting the
//                 command (#267 v2.67.1 symptom): when the dispatch
//                 threw SQLITE_BUSY from inside //pop's transaction,
//                 the textarea stayed empty and the user got no UI
//                 hint — the only signal was the dev-console log.
//                 Normalising thrown errors into the CommandResult
//                 shape lets the existing applyResult path restore
//                 the input + show "Command failed: <message>".
// Collaborators: components/Composer.tsx, lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import type { CommandResult } from "./handlers/types";

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run a command-dispatching async function and normalise any throw
 * into a CommandResult. The caller can always `await` without a
 * try/catch.
 */
export async function runWithRecovery(
  rawText: string,
  invoke: () => Promise<CommandResult | void>,
): Promise<CommandResult> {
  try {
    const result = await invoke();
    return result ?? {};
  } catch (err) {
    return {
      restoreText: rawText,
      hint: `Command failed: ${describeError(err)}`,
    };
  }
}
