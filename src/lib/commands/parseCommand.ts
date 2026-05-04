// ------------------------------------------------------------------
// Component: Command parser
// Responsibility: Recognize composer input that starts with '//' as
//                 an in-app command and return a discriminated union
//                 describing the parsed intent. Non-commands return
//                 'noop' so the caller falls through to the normal
//                 send pipeline.
// Collaborators: components/Composer.tsx, stores/conversationsStore,
//                lib/commands/specs (registry; #237).
// ------------------------------------------------------------------

import { findSpec } from "./specs";

export type ParsedCommand =
  | { kind: "noop" }
  // #240: 'limit' and 'limitsize' kinds removed. //limit and //limitsize
  // commands fall through findSpec as unknown verbs and resolve to noop.
  | { kind: "pin"; payload: { rest: string } }
  | { kind: "pins"; payload: { persona: string | null } }
  | { kind: "unpin"; payload: { userNumber: number } }
  | { kind: "unpinAll" }
  | { kind: "edit"; payload: { userNumber: number | null } }
  | { kind: "pop"; payload: { userNumber: number | null } }
  | { kind: "retry" }
  | { kind: "visibility"; payload: { mode: "separated" | "joined" } }
  | { kind: "visibilityStatus" }
  | { kind: "visibilityDefault" }
  | { kind: "help" }
  | { kind: "personas" }
  | { kind: "activeprompts" }
  | { kind: "stats" }
  | { kind: "select"; payload: { names: string[] } }
  | { kind: "selectAll" }
  | { kind: "vacuum" }
  | { kind: "compact"; payload: { preserve: number } }
  | { kind: "autocompact"; payload: { mode: "kTokens"; value: number; preserve?: number } }
  | { kind: "autocompact"; payload: { mode: "percent"; value: number; preserve?: number } }
  | { kind: "autocompact"; payload: { mode: "off" } }
  | { kind: "displayMode"; payload: { mode: "lines" | "cols" } }
  | { kind: "version" }
  | { kind: "log"; payload: { limit: number; clear: boolean } }
  | { kind: "fork"; payload: { userNumber: number | null } }
  | { kind: "error"; message: string };

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("//")) return { kind: "noop" };

  // Split into verb + rest. Use the first whitespace run.
  const rest = trimmed.slice(2);
  const spaceIdx = rest.search(/\s/);
  const verb = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
  const arg = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();

  // #237: registry-driven dispatch. Unknown verbs fall through as
  // `noop` so the input goes down the normal send pipeline (matching
  // pre-#237 behaviour where every unrecognised //verb was ignored).
  const spec = findSpec(verb);
  if (!spec) return { kind: "noop" };
  return spec.parse(arg);
}
