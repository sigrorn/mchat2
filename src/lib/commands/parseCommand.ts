// ------------------------------------------------------------------
// Component: Command parser
// Responsibility: Recognize composer input that starts with '//' as
//                 an in-app command and return a discriminated union
//                 describing the parsed intent. Non-commands return
//                 'noop' so the caller falls through to the normal
//                 send pipeline.
// Collaborators: components/Composer.tsx, stores/conversationsStore.
// ------------------------------------------------------------------

export type ParsedCommand =
  | { kind: "noop" }
  | { kind: "limit"; payload: { userNumber: number | null } }
  | { kind: "error"; message: string };

const LIMIT_HELP =
  "limit: specify the user message number for the limit. " +
  "Messages before that one will no longer be transmitted to the selected AI. " +
  "Use //limit NONE to clear the limit.";

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("//")) return { kind: "noop" };

  // Split into verb + rest. Use the first whitespace run.
  const rest = trimmed.slice(2);
  const spaceIdx = rest.search(/\s/);
  const verb = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
  const arg = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();

  if (verb === "limit") return parseLimit(arg);
  return { kind: "noop" };
}

function parseLimit(arg: string): ParsedCommand {
  if (arg === "") return { kind: "error", message: LIMIT_HELP };
  // 'NONE' is canonical (#10); 'ALL' is kept as a backwards-compat
  // alias because the original release shipped with that name.
  const lc = arg.toLowerCase();
  if (lc === "none" || lc === "all") {
    return { kind: "limit", payload: { userNumber: null } };
  }
  if (!/^-?\d+$/.test(arg)) {
    return {
      kind: "error",
      message: `limit: '${arg}' is not a valid message number. Use //limit N or //limit NONE.`,
    };
  }
  const n = Number(arg);
  if (n < 1) {
    return {
      kind: "error",
      message: `limit: '${arg}' is not a valid message number. Use //limit N or //limit NONE.`,
    };
  }
  return { kind: "limit", payload: { userNumber: n } };
}
