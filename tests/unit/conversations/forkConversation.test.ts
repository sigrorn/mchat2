// ------------------------------------------------------------------
// Component: forkConversation use case tests (#224)
// Responsibility: Verify the //fork command's branching semantics:
//                 cut points, persona+flow cloning with id remap,
//                 superseded handling, pinned/notice preservation.
// Collaborators: src/lib/conversations/forkConversation (under test).
// ------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { forkConversation, ForkRangeError } from "@/lib/conversations/forkConversation";
import { createPersona } from "@/lib/personas/service";
import { listPersonas } from "@/lib/persistence/personas";
import * as convRepo from "@/lib/persistence/conversations";
import * as messagesRepo from "@/lib/persistence/messages";
import * as flowsRepo from "@/lib/persistence/flows";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import type { Conversation } from "@/lib/types";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function makeSourceConversation(): Promise<Conversation> {
  return convRepo.createConversation({
    title: "Source",
    systemPrompt: "global",
    lastProvider: null,
    limitMarkIndex: null,
    displayMode: "lines",
    visibilityMode: "joined",
    visibilityMatrix: {},
    limitSizeTokens: null,
    selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
  });
}

async function appendUser(convId: string, content: string): Promise<void> {
  await messagesRepo.appendMessage({
    conversationId: convId,
    role: "user",
    content,
    provider: null,
    model: null,
    personaId: null,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
  });
}

async function appendAssistant(
  convId: string,
  personaId: string,
  content: string,
): Promise<void> {
  await messagesRepo.appendMessage({
    conversationId: convId,
    role: "assistant",
    content,
    provider: "mock",
    model: "mock-model",
    personaId,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
  });
}

describe("forkConversation (#224)", () => {
  it("//fork (no arg): copies all current messages, personas, flow", async () => {
    const conv = await makeSourceConversation();
    const a = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    await appendUser(conv.id, "u1");
    await appendAssistant(conv.id, a.id, "a1");
    await appendUser(conv.id, "u2");
    await appendAssistant(conv.id, a.id, "a2");

    const personas = await listPersonas(conv.id);
    const messages = await messagesRepo.listMessages(conv.id);
    const result = await forkConversation({
      source: conv,
      sourcePersonas: personas,
      sourceMessages: messages,
      sourceFlow: null,
      cutAtUserNumber: null,
    });

    expect(result.title).toBe("Fork of Source");
    expect(result.id).not.toBe(conv.id);
    const forkedMsgs = await messagesRepo.listMessages(result.id);
    expect(forkedMsgs).toHaveLength(4);
    expect(forkedMsgs.map((m) => m.content)).toEqual(["u1", "a1", "u2", "a2"]);
    const forkedPs = await listPersonas(result.id);
    expect(forkedPs).toHaveLength(1);
    expect(forkedPs[0]!.name).toBe("Alice");
    expect(forkedPs[0]!.id).not.toBe(a.id); // fresh id
  });

  it("//fork N: keeps user 1..N-1 with their assistant responses", async () => {
    const conv = await makeSourceConversation();
    const a = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    // 5 user messages, each with one assistant reply
    for (let i = 1; i <= 5; i++) {
      await appendUser(conv.id, `u${i}`);
      await appendAssistant(conv.id, a.id, `a${i}`);
    }
    const personas = await listPersonas(conv.id);
    const messages = await messagesRepo.listMessages(conv.id);

    // //fork 3 → cuts just before user 3 → keeps u1, a1, u2, a2
    const forked = await forkConversation({
      source: conv,
      sourcePersonas: personas,
      sourceMessages: messages,
      sourceFlow: null,
      cutAtUserNumber: 3,
    });
    const forkedMsgs = await messagesRepo.listMessages(forked.id);
    expect(forkedMsgs.map((m) => m.content)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("//fork 1: empty message list, but personas + settings copied", async () => {
    const conv = await makeSourceConversation();
    const a = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    await appendUser(conv.id, "u1");
    await appendAssistant(conv.id, a.id, "a1");
    const personas = await listPersonas(conv.id);
    const messages = await messagesRepo.listMessages(conv.id);

    const forked = await forkConversation({
      source: conv,
      sourcePersonas: personas,
      sourceMessages: messages,
      sourceFlow: null,
      cutAtUserNumber: 1,
    });
    const forkedMsgs = await messagesRepo.listMessages(forked.id);
    expect(forkedMsgs).toHaveLength(0);
    const forkedPs = await listPersonas(forked.id);
    expect(forkedPs).toHaveLength(1);
    expect(forkedPs[0]!.name).toBe("Alice");
  });

  it("//fork N out of range → throws ForkRangeError", async () => {
    const conv = await makeSourceConversation();
    await appendUser(conv.id, "u1");
    const messages = await messagesRepo.listMessages(conv.id);
    await expect(
      forkConversation({
        source: conv,
        sourcePersonas: [],
        sourceMessages: messages,
        sourceFlow: null,
        cutAtUserNumber: 99,
      }),
    ).rejects.toThrow(ForkRangeError);
  });

  it("inherits flow with id-remapped persona references and copies cursor", async () => {
    const conv = await makeSourceConversation();
    const a = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    const b = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Bob",
      currentMessageIndex: 0,
    });
    await flowsRepo.upsertFlow(conv.id, {
      currentStepIndex: 1,
      loopStartIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: [a.id, b.id] },
      ],
    });
    await appendUser(conv.id, "u1");
    const personas = await listPersonas(conv.id);
    const messages = await messagesRepo.listMessages(conv.id);
    const flow = await flowsRepo.getFlow(conv.id);

    const forked = await forkConversation({
      source: conv,
      sourcePersonas: personas,
      sourceMessages: messages,
      sourceFlow: flow,
      cutAtUserNumber: null,
    });
    const newFlow = await flowsRepo.getFlow(forked.id);
    expect(newFlow).not.toBeNull();
    expect(newFlow!.currentStepIndex).toBe(1);
    expect(newFlow!.steps).toHaveLength(2);
    expect(newFlow!.steps[0]!.kind).toBe("user");
    expect(newFlow!.steps[1]!.kind).toBe("personas");

    const forkedPs = await listPersonas(forked.id);
    const newA = forkedPs.find((p) => p.name === "Alice")!;
    const newB = forkedPs.find((p) => p.name === "Bob")!;
    expect(newFlow!.steps[1]!.personaIds.sort()).toEqual([newA.id, newB.id].sort());
    // ids must be fresh, not source ids
    expect(newFlow!.steps[1]!.personaIds).not.toContain(a.id);
    expect(newFlow!.steps[1]!.personaIds).not.toContain(b.id);
  });

  it("skips superseded messages from the source", async () => {
    const conv = await makeSourceConversation();
    const a = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    await appendUser(conv.id, "u1");
    await appendAssistant(conv.id, a.id, "a1-bad"); // will be superseded
    await appendAssistant(conv.id, a.id, "a1-good");
    const allMsgs = await messagesRepo.listMessages(conv.id);
    // Mark the "a1-bad" message superseded.
    const bad = allMsgs.find((m) => m.content === "a1-bad")!;
    await messagesRepo.markMessagesSuperseded([bad.id], Date.now());
    const fresh = await messagesRepo.listMessages(conv.id);
    const personas = await listPersonas(conv.id);

    const forked = await forkConversation({
      source: conv,
      sourcePersonas: personas,
      sourceMessages: fresh,
      sourceFlow: null,
      cutAtUserNumber: null,
    });
    const forkedMsgs = await messagesRepo.listMessages(forked.id);
    expect(forkedMsgs.map((m) => m.content)).toEqual(["u1", "a1-good"]);
  });

  it("preserves pinned messages and notices in the kept range", async () => {
    const conv = await makeSourceConversation();
    const a = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    // pinned message
    await messagesRepo.appendMessage({
      conversationId: conv.id,
      role: "user",
      content: "pin me",
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines",
      pinned: true,
      pinTarget: a.id,
      addressedTo: [],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
    await appendUser(conv.id, "u1");
    // notice
    await messagesRepo.appendMessage({
      conversationId: conv.id,
      role: "notice",
      content: "system note",
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines",
      pinned: false,
      pinTarget: null,
      addressedTo: [],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
    await appendAssistant(conv.id, a.id, "a1");

    const personas = await listPersonas(conv.id);
    const messages = await messagesRepo.listMessages(conv.id);
    const forked = await forkConversation({
      source: conv,
      sourcePersonas: personas,
      sourceMessages: messages,
      sourceFlow: null,
      cutAtUserNumber: null,
    });
    const forkedMsgs = await messagesRepo.listMessages(forked.id);
    const pinned = forkedMsgs.find((m) => m.content === "pin me")!;
    expect(pinned.pinned).toBe(true);
    const newPs = await listPersonas(forked.id);
    expect(pinned.pinTarget).toBe(newPs[0]!.id); // remapped
    const notice = forkedMsgs.find((m) => m.role === "notice");
    expect(notice).toBeDefined();
    expect(notice!.content).toBe("system note");
  });

  it("copies system prompt, display mode, visibility mode, limits", async () => {
    const conv = await convRepo.createConversation({
      title: "Settings src",
      systemPrompt: "global rules",
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "cols",
      visibilityMode: "separated",
      visibilityMatrix: {},
      limitSizeTokens: 8000,
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    const personas = await listPersonas(conv.id);
    const messages = await messagesRepo.listMessages(conv.id);
    const forked = await forkConversation({
      source: conv,
      sourcePersonas: personas,
      sourceMessages: messages,
      sourceFlow: null,
      cutAtUserNumber: null,
    });
    expect(forked.systemPrompt).toBe("global rules");
    expect(forked.displayMode).toBe("cols");
    expect(forked.visibilityMode).toBe("separated");
    expect(forked.limitSizeTokens).toBe(8000);
  });
});
