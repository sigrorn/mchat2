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
  | { kind: "unpinAll" }
  | { kind: "edit"; payload: { userNumber: number | null } }
  | { kind: "pop"; payload: { userNumber: number | null } }
  | { kind: "retry" }
  | { kind: "limitsize"; payload: { kTokens: number | null } }
  | { kind: "visibility"; payload: { mode: "separated" | "joined" } }
  | { kind: "visibilityStatus" }
  | { kind: "visibilityDefault" }
  | { kind: "order" }
  | { kind: "help" }
  | { kind: "personas" }
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
    if (arg === "") return { kind: "pop", payload: { userNumber: null } };
    if (!/^\d+$/.test(arg)) {
      return { kind: "error", message: `pop: '${arg}' is not a valid message number.` };
    }
    return { kind: "pop", payload: { userNumber: Number(arg) } };
  }
  if (verb === "retry") {
    if (arg !== "") {
      return { kind: "error", message: "retry: this command takes no arguments." };
    }
    return { kind: "retry" };
  }
  if (verb === "limitsize") {
    if (arg === "") return { kind: "limitsize", payload: { kTokens: null } };
    if (!/^\d+$/.test(arg)) {
      return {
        kind: "error",
        message: `limitsize: '${arg}' is not a valid number. Use //limitsize or //limitsize N (k-tokens).`,
      };
    }
    return { kind: "limitsize", payload: { kTokens: Number(arg) } };
  }
  if (verb === "visibility") {
    if (arg === "") return { kind: "visibilityStatus" };
    const lc = arg.toLowerCase();
    if (lc === "separated") return { kind: "visibility", payload: { mode: "separated" } };
    if (lc === "full" || lc === "joined") return { kind: "visibility", payload: { mode: "joined" } };
    if (lc === "default") return { kind: "visibilityDefault" };
    return {
      kind: "error",
      message: `visibility: unknown mode '${arg}'. Use //visibility, //visibility separated, //visibility full, or //visibility default.`,
    };
  }
  if (verb === "help") {
    return { kind: "help" };
  }
  if (verb === "personas") {
    if (arg !== "") return { kind: "error", message: "personas: this command takes no arguments." };
    return { kind: "personas" };
  }
  if (verb === "stats") {
    if (arg !== "") return { kind: "error", message: "stats: this command takes no arguments." };
    return { kind: "stats" };
  }
  if (verb === "order") {
    if (arg !== "") {
      return { kind: "error", message: "order: this command takes no arguments." };
    }
    return { kind: "order" };
  }
  if (verb === "select") {
    if (arg === "") {
      return { kind: "error", message: "select: specify persona names (comma-separated) or ALL." };
    }
    if (arg.toLowerCase() === "all") return { kind: "selectAll" };
    const names = [...new Set(
      arg.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== ""),
    )];
    if (names.length === 0) {
      return { kind: "error", message: "select: no valid names provided." };
    }
    return { kind: "select", payload: { names } };
  }
  if (verb === "vacuum") {
    if (arg !== "") return { kind: "error", message: "vacuum: this command takes no arguments." };
    return { kind: "vacuum" };
  }
  if (verb === "compact") {
    if (arg === "") return { kind: "compact", payload: { preserve: 0 } };
    const negMatch = arg.match(/^-(\d+)$/);
    if (!negMatch) {
      return {
        kind: "error",
        message: `compact: '${arg}' is not a valid preservation count. Use //compact or //compact -N (preserve last N user messages).`,
      };
    }
    return { kind: "compact", payload: { preserve: Number(negMatch[1]) } };
  }
  if (verb === "autocompact") {
    return parseAutocompact(arg);
  }
  if (verb === "version") {
    if (arg !== "") return { kind: "error", message: "version: this command takes no arguments." };
    return { kind: "version" };
  }
  if (verb === "log") {
    // //log        → show last 50 events
    // //log N      → show last N events
    // //log clear  → empty the buffer
    if (arg === "" || arg === "clear") {
      return { kind: "log", payload: { limit: 50, clear: arg === "clear" } };
    }
    const n = Number.parseInt(arg, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return { kind: "error", message: "log: argument must be a positive integer or 'clear'." };
    }
    return { kind: "log", payload: { limit: n, clear: false } };
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
      message: "unpin: specify the user message number to unpin (e.g. //unpin 3 or //unpin ALL).",
    };
  }
  if (arg.toLowerCase() === "all") return { kind: "unpinAll" };
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

function parseAutocompact(arg: string): ParsedCommand {
  if (arg === "") {
    return {
      kind: "error",
      message:
        "autocompact: specify a threshold. Use //autocompact Nk (e.g. 12k for k-tokens), //autocompact N% (percent of tightest model), or //autocompact off.",
    };
  }
  // Split into threshold part and optional "preserve -N" suffix.
  const preserveMatch = arg.match(/^(.*?)\s+preserve(?:\s+(.*))?$/i);
  const thresholdArg = preserveMatch ? preserveMatch[1]!.trim() : arg;
  const preserveArg = preserveMatch ? (preserveMatch[2] ?? "").trim() : null;

  let preserve: number | undefined;
  if (preserveArg !== null) {
    if (preserveArg === "") {
      return {
        kind: "error",
        message: "autocompact: 'preserve' requires a count (e.g. //autocompact 12k preserve -2).",
      };
    }
    const preserveNeg = preserveArg.match(/^-(\d+)$/);
    if (!preserveNeg) {
      return {
        kind: "error",
        message: `autocompact: preserve count '${preserveArg}' must be negative (e.g. -2 for last 2 user messages).`,
      };
    }
    preserve = Number(preserveNeg[1]);
  }

  const lc = thresholdArg.toLowerCase();
  if (lc === "off") {
    if (preserveArg !== null) {
      return {
        kind: "error",
        message: "autocompact: 'preserve' cannot be combined with 'off'.",
      };
    }
    return { kind: "autocompact", payload: { mode: "off" } };
  }
  const pctMatch = thresholdArg.match(/^(\d+)%$/);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    if (pct < 1 || pct > 100) {
      return { kind: "error", message: `autocompact: percentage must be between 1 and 100.` };
    }
    return {
      kind: "autocompact",
      payload: { mode: "percent", value: pct, ...(preserve !== undefined ? { preserve } : {}) },
    };
  }
  const kMatch = thresholdArg.match(/^(\d+)k$/i);
  if (kMatch) {
    const n = Number(kMatch[1]);
    if (n < 1) {
      return { kind: "error", message: `autocompact: threshold must be at least 1k.` };
    }
    return {
      kind: "autocompact",
      payload: { mode: "kTokens", value: n, ...(preserve !== undefined ? { preserve } : {}) },
    };
  }
  return {
    kind: "error",
    message: `autocompact: '${thresholdArg}' is not valid. Use //autocompact Nk (e.g. 12k), //autocompact N%, or //autocompact off.`,
  };
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
  if (n < 0) {
    return {
      kind: "error",
      message: `limit: '${arg}' is not a valid message number. Use //limit N, //limit 0 to hide all, or //limit NONE to clear.`,
    };
  }
  // #51: 0 is a special 'hide all current messages' sentinel. The
  // dispatcher translates it to a limitMarkIndex past the last row.
  return { kind: "limit", payload: { userNumber: n } };
}
