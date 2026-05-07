// #273 — Persona reorder helper. Takes a conversation id and a new
// ordering of persona ids; rewrites sortOrder on every persona that
// moved, inside one transaction so a partial failure rolls back.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import * as conversationsRepo from "@/lib/persistence/conversations";
import * as personasRepo from "@/lib/persistence/personas";
import { reorderPersonas } from "@/lib/app/reorderPersonas";
import type { Persona } from "@/lib/types";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
  vi.restoreAllMocks();
});

const baseConv = {
  id: "c1",
  title: "T",
  systemPrompt: null,
  lastProvider: null,
  displayMode: "lines" as const,
  visibilityMode: "joined" as const,
  visibilityMatrix: {},
  selectedPersonas: [],
  compactionFloorIndex: null,
  autocompactThreshold: null,
  contextWarningsFired: [],
};

function persona(id: string, sortOrder: number): Persona {
  return {
    id,
    conversationId: "c1",
    provider: "mock",
    name: id.toUpperCase(),
    nameSlug: id,
    systemPromptOverride: null,
    modelOverride: "mock-1",
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder,
    deletedAt: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
  };
}

async function seed(): Promise<void> {
  await conversationsRepo.createConversation(baseConv);
  await personasRepo.createPersona(persona("p1", 0));
  await personasRepo.createPersona(persona("p2", 1));
  await personasRepo.createPersona(persona("p3", 2));
}

describe("reorderPersonas (#273)", () => {
  it("rewrites sortOrder so the new order matches the supplied ids", async () => {
    handle = await createTestDb();
    await seed();

    await reorderPersonas("c1", ["p3", "p1", "p2"]);

    const after = await personasRepo.listPersonas("c1");
    expect(after.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
    // Sort orders should be strictly increasing (no ties — listPersonas
    // falls back to name on ties, which would silently re-order).
    const orders = after.map((p) => p.sortOrder);
    expect(orders[0]).toBeLessThan(orders[1]!);
    expect(orders[1]).toBeLessThan(orders[2]!);
  });

  it("rolls back if a write throws mid-rewrite", async () => {
    handle = await createTestDb();
    await seed();

    let calls = 0;
    const real = personasRepo.updatePersona;
    vi.spyOn(personasRepo, "updatePersona").mockImplementation(async (p, dbi) => {
      calls += 1;
      if (calls === 2) throw new Error("synthetic mid-reorder failure");
      return real(p, dbi);
    });

    await expect(reorderPersonas("c1", ["p3", "p1", "p2"])).rejects.toThrow(
      "synthetic mid-reorder failure",
    );

    // Ordering must be unchanged from the seeded state.
    const after = await personasRepo.listPersonas("c1");
    expect(after.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("is a no-op when the new order matches the current order", async () => {
    handle = await createTestDb();
    await seed();
    const updateSpy = vi.spyOn(personasRepo, "updatePersona");

    await reorderPersonas("c1", ["p1", "p2", "p3"]);

    // Optimisation: only personas whose sortOrder actually changed get
    // rewritten. Identical order = zero writes.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("serializes the updatePersona writes (one in flight at a time)", async () => {
    // Regression for the v2.73.2 SQLITE_BUSY-after-//pop bug. The
    // earlier impl push'd N updatePersona promises into an array and
    // then awaited them, which started all writes in parallel. Inside
    // a transaction's section-token (ADR 011), parallel writes land on
    // different sqlx pool connections, race against BEGIN IMMEDIATE's
    // writer lock, and trip SQLITE_BUSY. Pin that successive writes
    // do NOT overlap.
    handle = await createTestDb();
    await seed();

    let inflight = 0;
    let maxInflight = 0;
    const real = personasRepo.updatePersona;
    vi.spyOn(personasRepo, "updatePersona").mockImplementation(async (p, dbi) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      // Yield once so a competing concurrent call would have time to
      // race in if we were running parallel.
      await Promise.resolve();
      const r = await real(p, dbi);
      inflight -= 1;
      return r;
    });

    await reorderPersonas("c1", ["p3", "p1", "p2"]);

    expect(maxInflight).toBe(1);
  });

  it("ignores ids that don't exist in the conversation", async () => {
    handle = await createTestDb();
    await seed();

    // Caller might race against a delete; a stale ghost id in the
    // ordering shouldn't crash the whole rewrite.
    await reorderPersonas("c1", ["p3", "ghost", "p1", "p2"]);

    const after = await personasRepo.listPersonas("c1");
    expect(after.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
  });
});
