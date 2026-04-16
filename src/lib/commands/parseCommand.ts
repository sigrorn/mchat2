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
  | { kind: "pin"; payload: { rest: string } }
  | { kind: "pins"; payload: { persona: string | null } }
  | { kind: "unpin"; payload: { userNumber: number } }
  | { kind: "edit"; payload: { userNumber: number | null } }
  | { kind: "pop" }
  | { kind: "displayMode"; payload: { mode: "lines" | "cols" } }
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
  if (verb === "pin") return parsePin(arg);
  if (verb === "pins") return parsePins(arg);
  if (verb === "unpin") return parseUnpin(arg);
  if (verb === "edit") return parseEdit(arg);
  if (verb === "pop") {
    if (arg !== "") {
      return { kind: "error", message: "pop: this command takes no arguments." };
    }
    return { kind: "pop" };
  }
  if (verb === "lines" || verb === "cols") {
    if (arg !== "") {
      return {
        kind: "error",
        message: `${verb}: this command takes no arguments.`,
      };
    }
    return { kind: "displayMode", payload: { mode: verb } };
  }
  return { kind: "noop" };
}

function parsePin(arg: string): ParsedCommand {
  if (arg.trim() === "") {
    return {
      kind: "error",
      message:
        "pin: specify the target persona(s) and the message body. " +
        "Use //pin @name <message> or //pin @name1 @name2 <message> or //pin @all <message>.",
    };
  }
  return { kind: "pin", payload: { rest: arg } };
}

function parsePins(arg: string): ParsedCommand {
  const persona = arg.trim();
  return { kind: "pins", payload: { persona: persona === "" ? null : persona } };
}

function parseUnpin(arg: string): ParsedCommand {
  if (arg === "") {
    return {
      kind: "error",
      message: "unpin: specify the user message number to unpin (e.g. //unpin 3).",
    };
  }
  if (!/^-?\d+$/.test(arg)) {
    return {
      kind: "error",
      message: `unpin: '${arg}' is not a valid message number.`,
    };
  }
  const n = Number(arg);
  if (n < 1) {
    return { kind: "error", message: `unpin: '${arg}' is not a valid message number.` };
  }
  return { kind: "unpin", payload: { userNumber: n } };
}

function parseEdit(arg: string): ParsedCommand {
  if (arg === "") return { kind: "edit", payload: { userNumber: null } };
  if (!/^-?\d+$/.test(arg)) {
    return {
      kind: "error",
      message: `edit: '${arg}' is not a valid message number. Use //edit, //edit N, or //edit -N.`,
    };
  }
  const n = Number(arg);
  if (n === 0) {
    return {
      kind: "error",
      message: `edit: '${arg}' is not a valid message number. User messages are 1-indexed.`,
    };
  }
  return { kind: "edit", payload: { userNumber: n } };
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
