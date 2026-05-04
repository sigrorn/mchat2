// migrateRunsAfterToFlow — Phase 0 of #241 (now also Phase C).
//
// The shared migration takes a transient Map<personaId, parentIds[]>
// (built by import paths from a legacy file) and folds it into a
// conversation flow. Existing flows are never overwritten; missing
// flows get the level-grouping derivation. A trigger-specific notice
// is appended either way.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { migrateRunsAfterToFlow } from "@/lib/conversations/migrateRunsAfterToFlow";
import { createPersona } from "@/lib/personas/service";
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
    displayMode: "lines",
    visibilityMode: "joined",
    visibilityMatrix: {},
    selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
  });
  return c.id;
}

describe("migrateRunsAfterToFlow — derivation + persistence", () => {
  it("converts a linear chain a→b→c into an alternating user/personas flow", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0 });
    const c = await createPersona({ conversationId: cid, provider: "mock", name: "C", currentMessageIndex: 0 });
    const map = new Map<string, readonly string[]>([
      [b.id, [a.id]],
      [c.id, [b.id]],
    ]);

    const result = await migrateRunsAfterToFlow(cid, map, { trigger: "open" });

    expect(result.converted).toBe(true);
    expect(result.noticeAppended).toBe(true);

    const flow = await flowsRepo.getFlow(cid);
    expect(flow).not.toBeNull();
    const kinds = flow!.steps.map((s) => s.kind);
    expect(kinds).toEqual(["user", "personas", "user", "personas", "user", "personas", "user"]);

    const msgs = await messagesRepo.listMessages(cid);
    const notices = msgs.filter((m) => m.role === "notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.content).toMatch(/runs_after/);
    expect(notices[0]!.content).toMatch(/conversation flow/i);
  });

  it("collapses diamond a→{b,c}→d into one personas-step per level", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0 });
    const c = await createPersona({ conversationId: cid, provider: "mock", name: "C", currentMessageIndex: 0 });
    const d = await createPersona({ conversationId: cid, provider: "mock", name: "D", currentMessageIndex: 0 });
    const map = new Map<string, readonly string[]>([
      [b.id, [a.id]],
      [c.id, [a.id]],
      [d.id, [b.id, c.id]],
    ]);

    await migrateRunsAfterToFlow(cid, map, { trigger: "open" });

    const flow = await flowsRepo.getFlow(cid);
    const personaSteps = flow!.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(3);
    expect(personaSteps[1]!.personaIds.sort()).toEqual([b.id, c.id].sort());
  });

  it("is a no-op when the supplied map is empty", async () => {
    const cid = await makeConv();
    await createPersona({ conversationId: cid, provider: "mock", name: "Solo", currentMessageIndex: 0 });

    const result = await migrateRunsAfterToFlow(cid, new Map(), { trigger: "open" });

    expect(result.converted).toBe(false);
    expect(result.noticeAppended).toBe(false);
    const flow = await flowsRepo.getFlow(cid);
    expect(flow).toBeNull();
    const msgs = await messagesRepo.listMessages(cid);
    expect(msgs.filter((m) => m.role === "notice")).toHaveLength(0);
  });

  it("does not overwrite an existing flow", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0 });
    await flowsRepo.upsertFlow(cid, {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: [a.id] },
      ],
    });
    const map = new Map<string, readonly string[]>([[b.id, [a.id]]]);

    const result = await migrateRunsAfterToFlow(cid, map, { trigger: "open" });

    expect(result.converted).toBe(false);
    expect(result.noticeAppended).toBe(true);
    const flow = await flowsRepo.getFlow(cid);
    expect(flow!.steps).toHaveLength(2);
  });

  it("ignores tombstoned personas when deriving the flow", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0 });
    await personasRepo.tombstonePersona(a.id);
    const map = new Map<string, readonly string[]>([[b.id, [a.id]]]);

    await migrateRunsAfterToFlow(cid, map, { trigger: "open" });

    const flow = await flowsRepo.getFlow(cid);
    const personaSteps = flow!.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(1);
    expect(personaSteps[0]!.personaIds).toEqual([b.id]);
  });
});

describe("migrateRunsAfterToFlow — trigger wording", () => {
  it("uses re-export wording for trigger=import", async () => {
    const cid = await makeConv();
    const a = await createPersona({ conversationId: cid, provider: "mock", name: "A", currentMessageIndex: 0 });
    const b = await createPersona({ conversationId: cid, provider: "mock", name: "B", currentMessageIndex: 0 });
    const map = new Map<string, readonly string[]>([[b.id, [a.id]]]);

    await migrateRunsAfterToFlow(cid, map, { trigger: "import" });

    const msgs = await messagesRepo.listMessages(cid);
    const notice = msgs.find((m) => m.role === "notice");
    expect(notice).toBeDefined();
    expect(notice!.content).toMatch(/Re-export/i);
    expect(notice!.content).toMatch(/runs_after/);
  });
});
