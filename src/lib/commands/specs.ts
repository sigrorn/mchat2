// ------------------------------------------------------------------
// Component: Command-spec registry (#237)
// Responsibility: Single source of truth for every //command's
//                 metadata + argument parser. parseCommand resolves
//                 verb→spec and delegates payload parsing here;
//                 formatHelp generates its markdown tables from the
//                 same array; #238's autocomplete cycles through
//                 the same verbs.
// Collaborators: lib/commands/parseCommand, lib/commands/help,
//                lib/commands/triggerHelp, future lib/composer/complete.
// Pure — no DB, no state.
// ------------------------------------------------------------------

import type { ParsedCommand } from "./parseCommand";

export type CommandSection =
  | "context"
  | "pins"
  | "editing"
  | "display"
  | "selection"
  | "info"
  | "maintenance";

export interface CommandUsage {
  /** Form as it appears in //help. e.g. "//limit N" */
  form: string;
  description: string;
}

export interface CommandSpec {
  verb: string;
  aliases?: string[];
  section: CommandSection;
  usages: CommandUsage[];
  parse: (arg: string) => ParsedCommand;
  /** Autocomplete behaviour (#238). */
  completion?: { appendSpaceOnComplete: boolean };
}

const LIMIT_HELP =
  "limit: specify the user message number for the limit. " +
  "Messages before that one will no longer be transmitted to the selected AI. " +
  "Use //limit NONE to clear the limit.";

function parseLimit(arg: string): ParsedCommand {
  if (arg === "") return { kind: "error", message: LIMIT_HELP };
  const lc = arg.toLowerCase();
  // 'NONE' is canonical (#10); 'ALL' is kept as a backwards-compat alias.
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
  // #51: 0 is a special 'hide all current messages' sentinel.
  return { kind: "limit", payload: { userNumber: n } };
}

function parseLimitsize(arg: string): ParsedCommand {
  if (arg === "") return { kind: "limitsize", payload: { kTokens: null } };
  if (!/^\d+$/.test(arg)) {
    return {
      kind: "error",
      message: `limitsize: '${arg}' is not a valid number. Use //limitsize or //limitsize N (k-tokens).`,
    };
  }
  return { kind: "limitsize", payload: { kTokens: Number(arg) } };
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
    return { kind: "error", message: `unpin: '${arg}' is not a valid message number.` };
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

function parsePop(arg: string): ParsedCommand {
  if (arg === "") return { kind: "pop", payload: { userNumber: null } };
  if (!/^\d+$/.test(arg)) {
    return { kind: "error", message: `pop: '${arg}' is not a valid message number.` };
  }
  return { kind: "pop", payload: { userNumber: Number(arg) } };
}

function parseRetry(arg: string): ParsedCommand {
  if (arg !== "") return { kind: "error", message: "retry: this command takes no arguments." };
  return { kind: "retry" };
}

function parseLines(arg: string): ParsedCommand {
  if (arg !== "") return { kind: "error", message: `lines: this command takes no arguments.` };
  return { kind: "displayMode", payload: { mode: "lines" } };
}

function parseCols(arg: string): ParsedCommand {
  if (arg !== "") return { kind: "error", message: `cols: this command takes no arguments.` };
  return { kind: "displayMode", payload: { mode: "cols" } };
}

function parseVisibility(arg: string): ParsedCommand {
  if (arg === "") return { kind: "visibilityStatus" };
  const lc = arg.toLowerCase();
  if (lc === "separated") return { kind: "visibility", payload: { mode: "separated" } };
  if (lc === "full" || lc === "joined") {
    return { kind: "visibility", payload: { mode: "joined" } };
  }
  if (lc === "default") return { kind: "visibilityDefault" };
  return {
    kind: "error",
    message: `visibility: unknown mode '${arg}'. Use //visibility, //visibility separated, //visibility full, or //visibility default.`,
  };
}

function parseSelect(arg: string): ParsedCommand {
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

function parseOrder(arg: string): ParsedCommand {
  if (arg !== "") return { kind: "error", message: "order: this command takes no arguments." };
  return { kind: "order" };
}

function parsePersonasInfo(arg: string): ParsedCommand {
  if (arg !== "") return { kind: "error", message: "personas: this command takes no arguments." };
  return { kind: "personas" };
}

function parseStats(arg: string): ParsedCommand {
  if (arg !== "") return { kind: "error", message: "stats: this command takes no arguments." };
  return { kind: "stats" };
}

function parseHelp(_arg: string): ParsedCommand {
  return { kind: "help" };
}

function parseVersion(arg: string): ParsedCommand {
  if (arg !== "") return { kind: "error", message: "version: this command takes no arguments." };
  return { kind: "version" };
}

function parseLog(arg: string): ParsedCommand {
  if (arg === "" || arg === "clear") {
    return { kind: "log", payload: { limit: 50, clear: arg === "clear" } };
  }
  const n = Number.parseInt(arg, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return { kind: "error", message: "log: argument must be a positive integer or 'clear'." };
  }
  return { kind: "log", payload: { limit: n, clear: false } };
}

function parseVacuum(arg: string): ParsedCommand {
  if (arg !== "") return { kind: "error", message: "vacuum: this command takes no arguments." };
  return { kind: "vacuum" };
}

function parseCompact(arg: string): ParsedCommand {
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

function parseAutocompact(arg: string): ParsedCommand {
  if (arg === "") {
    return {
      kind: "error",
      message:
        "autocompact: specify a threshold. Use //autocompact Nk (e.g. 12k for k-tokens), //autocompact N% (percent of tightest model), or //autocompact off.",
    };
  }
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
      return { kind: "error", message: "autocompact: 'preserve' cannot be combined with 'off'." };
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

function parseFork(arg: string): ParsedCommand {
  if (arg === "") return { kind: "fork", payload: { userNumber: null } };
  if (!/^-?\d+$/.test(arg)) {
    return {
      kind: "error",
      message: `fork: '${arg}' is not a valid user message number. Use //fork or //fork N.`,
    };
  }
  const n = Number(arg);
  if (n < 1) {
    return {
      kind: "error",
      message: `fork: '${arg}' is not a valid user message number. User messages are 1-indexed.`,
    };
  }
  return { kind: "fork", payload: { userNumber: n } };
}

export const COMMAND_SPECS: readonly CommandSpec[] = [
  // Context & limits
  {
    verb: "limit",
    section: "context",
    usages: [
      { form: "//limit N", description: "Hide messages before user message #N" },
      { form: "//limit 0", description: "Hide all current messages" },
      { form: "//limit NONE", description: "Clear the limit" },
    ],
    parse: parseLimit,
    completion: { appendSpaceOnComplete: true },
  },
  {
    verb: "limitsize",
    section: "context",
    usages: [
      { form: "//limitsize", description: "Auto-set token budget to tightest provider" },
      { form: "//limitsize N", description: "Set token budget to N thousand tokens" },
    ],
    parse: parseLimitsize,
    completion: { appendSpaceOnComplete: true },
  },
  // Pins
  {
    verb: "pin",
    section: "pins",
    usages: [
      { form: "//pin @name text", description: "Pin a message for a persona" },
      { form: "//pin @all text", description: "Pin a message for all personas" },
    ],
    parse: parsePin,
    completion: { appendSpaceOnComplete: true },
  },
  {
    verb: "pins",
    section: "pins",
    usages: [
      { form: "//pins", description: "List all pinned messages" },
      { form: "//pins name", description: "List pins for a specific persona" },
    ],
    parse: parsePins,
    completion: { appendSpaceOnComplete: true },
  },
  {
    verb: "unpin",
    section: "pins",
    usages: [
      { form: "//unpin N", description: "Unpin user message #N" },
      { form: "//unpin ALL", description: "Remove all pins" },
    ],
    parse: parseUnpin,
    completion: { appendSpaceOnComplete: true },
  },
  // Editing
  {
    verb: "edit",
    section: "editing",
    usages: [
      { form: "//edit", description: "Edit the last user message" },
      { form: "//edit N", description: "Edit user message #N" },
      { form: "//edit -N", description: "Edit the Nth-from-last user message" },
    ],
    parse: parseEdit,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "pop",
    section: "editing",
    usages: [
      { form: "//pop", description: "Remove the last user message and its responses" },
    ],
    parse: parsePop,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "retry",
    section: "editing",
    usages: [{ form: "//retry", description: "Retry the last failed response" }],
    parse: parseRetry,
    completion: { appendSpaceOnComplete: false },
  },
  // Display
  {
    verb: "lines",
    section: "display",
    usages: [{ form: "//lines", description: "Line-by-line display (default)" }],
    parse: parseLines,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "cols",
    section: "display",
    usages: [{ form: "//cols", description: "Side-by-side column display" }],
    parse: parseCols,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "visibility",
    section: "display",
    usages: [
      { form: "//visibility", description: "Show current visibility settings" },
      { form: "//visibility full", description: "All personas see all responses" },
      { form: "//visibility separated", description: "Each persona sees only its own responses" },
      { form: "//visibility default", description: "Reset to persona visibility defaults" },
    ],
    parse: parseVisibility,
    completion: { appendSpaceOnComplete: true },
  },
  // Selection
  {
    verb: "select",
    section: "selection",
    usages: [
      { form: "//select name, ...", description: "Set selection to listed personas" },
      { form: "//select ALL", description: "Select all personas" },
    ],
    parse: parseSelect,
    completion: { appendSpaceOnComplete: true },
  },
  // Info
  {
    verb: "order",
    section: "info",
    usages: [{ form: "//order", description: "Show DAG execution order" }],
    parse: parseOrder,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "personas",
    section: "info",
    usages: [{ form: "//personas", description: "List active personas with details" }],
    parse: parsePersonasInfo,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "stats",
    section: "info",
    usages: [{ form: "//stats", description: "Show conversation token statistics" }],
    parse: parseStats,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "help",
    section: "info",
    usages: [{ form: "//help", description: "Show this help text" }],
    parse: parseHelp,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "version",
    section: "info",
    usages: [{ form: "//version", description: "Show build version info" }],
    parse: parseVersion,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "log",
    section: "info",
    usages: [
      { form: "//log", description: "Show last 50 stream-lifecycle events (debug)" },
      { form: "//log N", description: "Show last N events" },
      { form: "//log clear", description: "Empty the event log" },
    ],
    parse: parseLog,
    completion: { appendSpaceOnComplete: true },
  },
  // Maintenance
  {
    verb: "compact",
    section: "maintenance",
    usages: [
      { form: "//compact", description: "Summarize the full conversation for each persona" },
      {
        form: "//compact -N",
        description: "Compact, preserving last N user messages (sample: `//compact -2`)",
      },
    ],
    parse: parseCompact,
    completion: { appendSpaceOnComplete: true },
  },
  {
    verb: "autocompact",
    section: "maintenance",
    usages: [
      {
        form: "//autocompact Nk",
        description:
          "Auto-compact when context reaches N k-tokens — the 'k' suffix is required (sample: `//autocompact 12k`)",
      },
      {
        form: "//autocompact N%",
        description:
          "Auto-compact at N% of the tightest model's context window (sample: `//autocompact 75%`)",
      },
      {
        form: "//autocompact Nk preserve -N",
        description:
          "Auto-compact with threshold + preserve last N user messages (sample: `//autocompact 12k preserve -2`)",
      },
      { form: "//autocompact off", description: "Disable auto-compaction (default)" },
    ],
    parse: parseAutocompact,
    completion: { appendSpaceOnComplete: true },
  },
  {
    verb: "vacuum",
    section: "maintenance",
    usages: [{ form: "//vacuum", description: "Compact the SQLite database" }],
    parse: parseVacuum,
    completion: { appendSpaceOnComplete: false },
  },
  {
    verb: "fork",
    section: "maintenance",
    usages: [
      { form: "//fork", description: "Branch a copy of this conversation (everything sent so far)" },
      {
        form: "//fork N",
        description: "Branch a copy keeping user messages 1..N-1 with their replies",
      },
    ],
    parse: parseFork,
    completion: { appendSpaceOnComplete: false },
  },
];

const SPEC_BY_VERB = (() => {
  const m = new Map<string, CommandSpec>();
  for (const spec of COMMAND_SPECS) {
    m.set(spec.verb, spec);
    for (const alias of spec.aliases ?? []) m.set(alias, spec);
  }
  return m;
})();

/** Resolve a verb (or alias) to its spec. Case-sensitive: callers should
 * lowercase the verb before lookup, matching the parseCommand contract. */
export function findSpec(verb: string): CommandSpec | undefined {
  return SPEC_BY_VERB.get(verb);
}
