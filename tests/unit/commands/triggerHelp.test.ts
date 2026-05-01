// triggerHelp dedup (#237). //help (and the //<TAB> shortcut from
// #238) both go through this helper. If the conversation's last
// visible row is already a help notice with the current help text,
// the call is silent. Any other intervening row resets the dedup.
import { describe, it, expect, beforeEach } from "vitest";
import { triggerHelp } from "@/lib/commands/triggerHelp";
import { formatHelp } from "@/lib/commands/help";
import type { Message } from "@/lib/types";

function notice(over: Partial<Message> & { id: string; content: string; index: number }): Message {
  return {
    id: over.id,
    conversationId: over.conversationId ?? "c1",
    role: "notice",
    content: over.content,
    provider: null,
    model: null,
    personaId: null,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    audience: [],
    index: over.index,
    createdAt: over.createdAt ?? 1000 + over.index,
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    confirmedAt: over.confirmedAt ?? null,
  } as Message;
}

function assistant(over: Partial<Message> & { id: string; index: number }): Message {
  return {
    ...notice({ id: over.id, content: "reply", index: over.index }),
    role: "assistant",
  } as Message;
}

interface Recorder {
  appended: Array<{ conversationId: string; content: string }>;
}

function makeDeps(messages: Message[]): { deps: Parameters<typeof triggerHelp>[0]; rec: Recorder } {
  const rec: Recorder = { appended: [] };
  const deps = {
    getMessages: (_: string) => messages,
    appendNotice: async (conversationId: string, content: string) => {
      rec.appended.push({ conversationId, content });
      messages.push(
        notice({
          id: `n_${rec.appended.length}`,
          content,
          index: messages.length,
        }),
      );
    },
  };
  return { deps, rec };
}

describe("triggerHelp (#237)", () => {
  const HELP = formatHelp();
  let messages: Message[];

  beforeEach(() => {
    messages = [];
  });

  it("first call → emits the help notice", async () => {
    const { deps, rec } = makeDeps(messages);
    await triggerHelp(deps, "c1");
    expect(rec.appended).toHaveLength(1);
    expect(rec.appended[0]?.content).toBe(HELP);
  });

  it("second call with help notice as last visible → silent", async () => {
    messages.push(notice({ id: "n_existing", content: HELP, index: 0 }));
    const { deps, rec } = makeDeps(messages);
    await triggerHelp(deps, "c1");
    expect(rec.appended).toHaveLength(0);
  });

  it("help → unrelated notice → help → second emit (dedup reset)", async () => {
    const { deps, rec } = makeDeps(messages);
    await triggerHelp(deps, "c1");
    expect(rec.appended).toHaveLength(1);
    // Unrelated notice between calls.
    messages.push(notice({ id: "n_other", content: "popped 1 message.", index: messages.length }));
    await triggerHelp(deps, "c1");
    expect(rec.appended).toHaveLength(2);
  });

  it("help → confirm-hide → help → re-emits (confirmed notice doesn't count as last visible)", async () => {
    messages.push(
      notice({ id: "n_help", content: HELP, index: 0, confirmedAt: 5000 }),
    );
    const { deps, rec } = makeDeps(messages);
    await triggerHelp(deps, "c1");
    expect(rec.appended).toHaveLength(1);
  });

  it("help → assistant turn → help → second emit", async () => {
    messages.push(notice({ id: "n_help", content: HELP, index: 0 }));
    messages.push(assistant({ id: "a1", index: 1 }));
    const { deps, rec } = makeDeps(messages);
    await triggerHelp(deps, "c1");
    expect(rec.appended).toHaveLength(1);
  });

  it("help text changes between calls → re-emits even if last row was the prior help", async () => {
    // Simulate a prior help notice with stale text.
    messages.push(notice({ id: "n_old_help", content: "## Old help text", index: 0 }));
    const { deps, rec } = makeDeps(messages);
    await triggerHelp(deps, "c1");
    expect(rec.appended).toHaveLength(1);
    expect(rec.appended[0]?.content).toBe(HELP);
  });

  it("ignores superseded notices when looking for the last visible row", async () => {
    // A superseded notice marker exists on assistant rows; notices
    // don't typically get superseded. But if a help notice were
    // somehow superseded (e.g. by a future feature), the dedup must
    // not lock on it.
    messages.push({
      ...notice({ id: "n_help", content: HELP, index: 0 }),
      supersededAt: 5000,
    } as Message);
    const { deps, rec } = makeDeps(messages);
    await triggerHelp(deps, "c1");
    expect(rec.appended).toHaveLength(1);
  });
});
