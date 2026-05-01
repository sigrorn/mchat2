// ------------------------------------------------------------------
// Component: Composer tab-completion helpers (#238)
// Responsibility: Three pure helpers that the Composer's Tab handler
//                 wires together: classify the token at the cursor,
//                 produce candidate completions, splice a chosen
//                 candidate back into the input. No React, no DOM.
// Collaborators: components/Composer (Tab handler),
//                lib/commands/specs (registry), lib/types (Persona).
// ------------------------------------------------------------------

import { COMMAND_SPECS } from "../commands/specs";

export interface CompletionRange {
  start: number;
  end: number;
}

export type CompletionToken =
  | { kind: "command"; prefix: string; range: CompletionRange }
  | { kind: "target"; prefix: string; range: CompletionRange }
  | { kind: "selection-add"; prefix: string; range: CompletionRange }
  | { kind: "selection-remove"; prefix: string; range: CompletionRange }
  | { kind: "none" };

interface PersonaLite {
  id: string;
  nameSlug: string;
}

export interface CompletionSources {
  personas: readonly PersonaLite[];
  /** True when a flow is attached. Currently unused — @convo is always
   * offered to keep Composer free of flow-state coupling. Reserved
   * for a future "only when meaningful" mode. */
  flowAttached: boolean;
}

const TOKEN_CHAR = /[A-Za-z0-9_-]/;

// Find the contiguous run of non-whitespace starting at `start`. Returns
// the end index (exclusive).
function tokenEndFrom(input: string, start: number): number {
  let i = start;
  while (i < input.length && TOKEN_CHAR.test(input[i]!)) i++;
  return i;
}

export function tokenAtCursor(input: string, cursor: number): CompletionToken {
  if (cursor < 0 || cursor > input.length) return { kind: "none" };

  // Skip leading whitespace.
  let runStart = 0;
  while (runStart < input.length && /\s/.test(input[runStart]!)) runStart++;

  // Command: cursor must lie within the leading "//verb" run, before
  // any whitespace inside the verb. Only valid at the very start of
  // input (modulo leading whitespace).
  if (input.startsWith("//", runStart)) {
    const verbStart = runStart + 2;
    const verbEnd = tokenEndFrom(input, verbStart);
    if (cursor >= runStart && cursor <= verbEnd) {
      return {
        kind: "command",
        prefix: input.slice(verbStart, cursor),
        range: { start: runStart, end: verbEnd },
      };
    }
    return { kind: "none" };
  }

  // Target / selection prefix run: walk a sequence of @xxx / +xxx / -xxx
  // tokens separated by whitespace. The run ends at the first
  // non-prefix character.
  let i = runStart;
  let lastTokenStart: number | null = null;
  let lastTokenLeader: "@" | "+" | "-" | null = null;
  let lastTokenEnd: number | null = null;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "@" || ch === "+" || ch === "-") {
      const tokenStart = i;
      const leader = ch as "@" | "+" | "-";
      const tokenEnd = tokenEndFrom(input, tokenStart + 1);
      if (cursor >= tokenStart && cursor <= tokenEnd) {
        const prefix = input.slice(tokenStart + 1, cursor);
        const range = { start: tokenStart, end: tokenEnd };
        if (leader === "@") return { kind: "target", prefix, range };
        if (leader === "+") return { kind: "selection-add", prefix, range };
        return { kind: "selection-remove", prefix, range };
      }
      lastTokenStart = tokenStart;
      lastTokenLeader = leader;
      lastTokenEnd = tokenEnd;
      i = tokenEnd;
      continue;
    }
    // Non-prefix character ends the run. If we've already passed the
    // cursor, it's a target token; otherwise the cursor is in the
    // body and is `none`.
    break;
  }
  // If the cursor sits exactly at the end of the prefix run (e.g.
  // user typed "@cl" with cursor at position 3), tokenEnd === cursor
  // is handled by the inner loop above. Anything past that is none.
  void lastTokenStart;
  void lastTokenLeader;
  void lastTokenEnd;
  return { kind: "none" };
}

export function candidatesFor(
  token: CompletionToken,
  sources: CompletionSources,
): string[] {
  if (token.kind === "none") return [];
  const prefix = token.prefix.toLowerCase();

  if (token.kind === "command") {
    if (prefix === "") return [];
    const out: string[] = [];
    for (const spec of COMMAND_SPECS) {
      if (spec.verb.startsWith(prefix)) out.push(`//${spec.verb}`);
      for (const alias of spec.aliases ?? []) {
        if (alias.startsWith(prefix)) out.push(`//${alias}`);
      }
    }
    return out.sort();
  }

  if (token.kind === "target") {
    const personaPicks = sources.personas
      .filter((p) => p.nameSlug.toLowerCase().startsWith(prefix))
      .map((p) => `@${p.nameSlug}`);
    const virtual: string[] = [];
    if ("all".startsWith(prefix)) virtual.push("@all");
    if ("convo".startsWith(prefix)) virtual.push("@convo");
    if ("others".startsWith(prefix) && sources.personas.length >= 2) {
      virtual.push("@others");
    }
    return [...personaPicks, ...virtual].sort();
  }

  // selection-add / selection-remove: persona slugs only.
  const leader = token.kind === "selection-add" ? "+" : "-";
  return sources.personas
    .filter((p) => p.nameSlug.toLowerCase().startsWith(prefix))
    .map((p) => `${leader}${p.nameSlug}`)
    .sort();
}

export interface ApplyCompletionResult {
  text: string;
  cursor: number;
}

export function applyCompletion(
  input: string,
  range: CompletionRange,
  replacement: string,
  opts: { appendSpaceOnComplete: boolean },
): ApplyCompletionResult {
  const before = input.slice(0, range.start);
  const after = input.slice(range.end);
  const nextChar = after.length > 0 ? after[0]! : "";
  const needsSpace =
    opts.appendSpaceOnComplete && nextChar !== "" && /\s/.test(nextChar) === false;
  const trailing = opts.appendSpaceOnComplete && after.length === 0 ? " " : "";
  const inserted = needsSpace ? replacement + " " : replacement + trailing;
  const text = before + inserted + after;
  return { text, cursor: before.length + inserted.length };
}
