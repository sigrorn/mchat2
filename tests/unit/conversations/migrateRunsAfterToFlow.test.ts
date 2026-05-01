// migrateRunsAfterToFlow — Phase 0 of #241.
//
// One shared service used by Trigger A (lazy-on-open) and Trigger B
// (persona / snapshot import). Idempotent, never overwrites an existing
// flow, clears runsAfter on conversion, appends a trigger-specific
// notice row.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { migrateRunsAfterToFlow } from "@/lib/conversations/migrateRunsAfterToFlow";
import { createPersona, updatePersona } from "@/lib/personas/service";
import * as personasRepo from "@/lib/persistence/personas";
import * as messagesRepo from "@/lib/persistence/messages";
import * as flowsRepo from "@/lib/persistence/flows";
import * as convRepo from "@/lib/persistence/conversations";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function makeConv(): Promise<string> {
  const c = await convRepo.createConversation({
    title: "T",
    systemPrompt: null,
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
  return c.id;
}

describe("migrateRunsAfterToFlow — Trigger A (lazy-on-open)", () => {
  it("converts a linear chain a→b→c into an alternating user/personas flow", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0, runsAfter: [a.id] });
    await createPersona({ conversationId: cid, provider: "mock", name: "C", currentMessageIndex: 0, runsAfter: [b.id] });

    const result = await migrateRunsAfterToFlow(cid, { trigger: "open" });

    expect(result.converted).toBe(true);
    expect(result.cleared).toBe(true);
    expect(result.noticeAppended).toBe(true);

    const flow = await flowsRepo.getFlow(cid);
    expect(flow).not.toBeNull();
    const kinds = flow!.steps.map((s) => s.kind);
    expect(kinds).toEqual(["user", "personas", "user", "personas", "user", "personas", "user"]);

    const ps = await personasRepo.listPersonas(cid);
    for (const p of ps) expect(p.runsAfter).toEqual([]);

    const msgs = await messagesRepo.listMessages(cid);
    const notices = msgs.filter((m) => m.role === "notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.content).toMatch(/runs_after/);
    expect(notices[0]!.content).toMatch(/conversation flow/i);
  });

  it("collapses diamond a→{b,c}→d into one personas-step per level", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0, runsAfter: [a.id] });
    const c = await createPersona({ conversationId: cid, provider: "mock", name: "C", currentMessageIndex: 0, runsAfter: [a.id] });
    await createPersona({ conversationId: cid, provider: "mock", name: "D", currentMessageIndex: 0, runsAfter: [b.id, c.id] });

    await migrateRunsAfterToFlow(cid, { trigger: "open" });

    const flow = await flowsRepo.getFlow(cid);
    const personaSteps = flow!.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(3);
    expect(personaSteps[1]!.personaIds.sort()).toEqual([b.id, c.id].sort());
  });

  it("is a no-op when no persona has runsAfter", async () => {
    const cid = await makeConv();
    await createPersona({ conversationId: cid, provider: "mock", name: "Solo", currentMessageIndex: 0 });

    const result = await migrateRunsAfterToFlow(cid, { trigger: "open" });

    expect(result.converted).toBe(false);
    expect(result.cleared).toBe(false);
    expect(result.noticeAppended).toBe(false);
    const flow = await flowsRepo.getFlow(cid);
    expect(flow).toBeNull();
    const msgs = await messagesRepo.listMessages(cid);
    expect(msgs.filter((m) => m.role === "notice")).toHaveLength(0);
  });

  it("is idempotent — second invocation does not re-convert or re-notice", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0, runsAfter: [a.id] });

    const r1 = await migrateRunsAfterToFlow(cid, { trigger: "open" });
    expect(r1.converted).toBe(true);

    const r2 = await migrateRunsAfterToFlow(cid, { trigger: "open" });
    expect(r2.converted).toBe(false);
    expect(r2.cleared).toBe(false);
    expect(r2.noticeAppended).toBe(false);

    const msgs = await messagesRepo.listMessages(cid);
    expect(msgs.filter((m) => m.role === "notice")).toHaveLength(1);
  });

  it("does not overwrite an existing flow when runsAfter is somehow still set", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0, runsAfter: [a.id] });
    // Pre-attach a flow that has nothing to do with the legacy runs_after.
    await flowsRepo.upsertFlow(cid, {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: [a.id] },
      ],
    });

    const result = await migrateRunsAfterToFlow(cid, { trigger: "open" });

    // Flow stays as-is.
    expect(result.converted).toBe(false);
    // But runsAfter is cleared so the dual-state doesn't drift.
    expect(result.cleared).toBe(true);
    expect(result.noticeAppended).toBe(true);
    const reload = await personasRepo.getPersona(b.id);
    expect(reload!.runsAfter).toEqual([]);
    const flow = await flowsRepo.getFlow(cid);
    expect(flow!.steps).toHaveLength(2); // unchanged from the pre-attached flow
  });

  it("ignores tombstoned personas when deriving the flow", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0, runsAfter: [a.id] });
    // Tombstone A. B's parent is gone; B should derive as a root.
    await personasRepo.tombstonePersona(a.id);

    await migrateRunsAfterToFlow(cid, { trigger: "open" });

    const flow = await flowsRepo.getFlow(cid);
    const personaSteps = flow!.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(1);
    expect(personaSteps[0]!.personaIds).toEqual([b.id]);
  });
});

describe("migrateRunsAfterToFlow — Trigger B (import notice)", () => {
  it("uses re-export wording for trigger=import", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0, runsAfter: [a.id] });

    await migrateRunsAfterToFlow(cid, { trigger: "import" });

    const msgs = await messagesRepo.listMessages(cid);
    const notice = msgs.find((m) => m.role === "notice");
    expect(notice).toBeDefined();
    expect(notice!.content).toMatch(/Re-export/i);
    expect(notice!.content).toMatch(/runs_after/);
  });

  it("clears imported runsAfter even when destination has a flow already", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0, runsAfter: [a.id] });
    await flowsRepo.upsertFlow(cid, {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: [a.id] },
      ],
    });

    const result = await migrateRunsAfterToFlow(cid, { trigger: "import" });

    expect(result.converted).toBe(false);
    expect(result.cleared).toBe(true);
    expect(result.noticeAppended).toBe(true);
    const reload = await personasRepo.getPersona(b.id);
    expect(reload!.runsAfter).toEqual([]);
  });
});
