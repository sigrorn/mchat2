// Persona import/export (de)serialization — issue #22.
import { describe, it, expect } from "vitest";
import {
  serializePersonas,
  parsePersonasImport,
  resolveImport,
  type ExportedPersona,
} from "@/lib/personas/importExport";
import type { Flow, Persona } from "@/lib/types";

function persona(over: Partial<Persona> & { id: string; name: string }): Persona {
  return {
    id: over.id,
    conversationId: over.conversationId ?? "c_1",
    provider: over.provider ?? "claude",
    name: over.name,
    nameSlug: over.nameSlug ?? over.name.toLowerCase(),
    systemPromptOverride: over.systemPromptOverride ?? null,
    modelOverride: over.modelOverride ?? null,
    colorOverride: over.colorOverride ?? null,
    createdAtMessageIndex: over.createdAtMessageIndex ?? 0,
    sortOrder: over.sortOrder ?? 0,
    deletedAt: over.deletedAt ?? null,
    apertusProductId: over.apertusProductId ?? null,
    visibilityDefaults: over.visibilityDefaults ?? {},
    openaiCompatPreset: null,
    roleLens: over.roleLens ?? {},
  };
}

describe("serializePersonas", () => {
  it("emits a version 1 envelope listing each live persona by name", () => {
    const ps: Persona[] = [
      persona({ id: "p_a", name: "Alice", systemPromptOverride: "be brief" }),
      persona({ id: "p_b", name: "Bob" }),
    ];
    const json = serializePersonas(ps);
    const parsed = JSON.parse(json) as { version: number; personas: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.personas).toHaveLength(2);
    // #241 Phase C: modern exports never emit runs_after — ordering
    // lives on the conversation flow now.
    for (const p of parsed.personas) {
      expect(p as Record<string, unknown>).not.toHaveProperty("runsAfter");
    }
  });

  it("skips tombstoned personas (deletedAt set)", () => {
    const ps: Persona[] = [
      persona({ id: "p_a", name: "Alice" }),
      persona({ id: "p_dead", name: "Old", deletedAt: 1 }),
    ];
    const parsed = JSON.parse(serializePersonas(ps)) as { personas: { name: string }[] };
    expect(parsed.personas.map((p) => p.name)).toEqual(["Alice"]);
  });
});

describe("parsePersonasImport", () => {
  it("rejects invalid JSON", () => {
    const r = parsePersonasImport("not-json{{");
    expect(r.ok).toBe(false);
  });

  it("rejects unknown version", () => {
    const r = parsePersonasImport(JSON.stringify({ version: 99, personas: [] }));
    expect(r.ok).toBe(false);
  });

  it("accepts a v1 file with persona entries", () => {
    const r = parsePersonasImport(
      JSON.stringify({
        version: 1,
        personas: [{ name: "Alice", provider: "claude" }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.personas[0]?.name).toBe("Alice");
  });

  it("soft-fails on entries missing required fields (#165)", () => {
    // Per-entry validation now drops bad personas instead of failing
    // the whole import — keeps a partly-corrupt file usable.
    const r = parsePersonasImport(
      JSON.stringify({
        version: 1,
        personas: [{ provider: "claude" }, { name: "Alice", provider: "claude" }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.personas).toHaveLength(1);
    expect(r.personas[0]?.name).toBe("Alice");
  });
});

function imp(over: Partial<ExportedPersona> & { name: string }): ExportedPersona {
  return {
    name: over.name,
    provider: over.provider ?? "claude",
    systemPromptOverride: over.systemPromptOverride ?? null,
    modelOverride: over.modelOverride ?? null,
    colorOverride: over.colorOverride ?? null,
    apertusProductId: over.apertusProductId ?? null,
    visibilityDefaults: over.visibilityDefaults ?? {},
    ...(over.runsAfter !== undefined ? { runsAfter: over.runsAfter } : {}),
    ...(over.roleLens ? { roleLens: over.roleLens } : {}),
  };
}

describe("resolveImport", () => {
  const existing: Persona[] = [persona({ id: "p_a", name: "Alice" })];

  it("creates new personas, skipping name collisions", () => {
    const r = resolveImport(existing, [imp({ name: "Alice" }), imp({ name: "Bob" })]);
    expect(r.toCreate.map((p) => p.name)).toEqual(["Bob"]);
    expect(r.skipped).toEqual(["Alice"]);
  });

  it("resolves runsAfter by name against the post-import set", () => {
    const r = resolveImport(existing, [
      imp({ name: "Bob", runsAfter: ["Alice"] }),
      imp({ name: "Carol", runsAfter: ["Bob"] }),
    ]);
    const carol = r.toCreate.find((p) => p.name === "Carol");
    expect(carol?.runsAfter).toEqual(["Bob"]);
  });

  it("nulls runsAfter when the referenced name is not present", () => {
    const r = resolveImport(existing, [imp({ name: "Bob", runsAfter: ["Ghost"] })]);
    expect(r.toCreate[0]?.runsAfter).toEqual([]);
  });
});

// #236 — personas export now optionally bundles the conversation's
// flow + each persona's roleLens so a reusable persona kit (e.g. an
// NVC setup) round-trips with all the configuration that makes it
// actually work, not just the prompts.

function flowWithSteps(
  steps: Array<{ kind: "user" | "personas"; personaIds: string[]; instruction?: string | null }>,
  cursor = 0,
  loopStart = 0,
): Flow {
  return {
    id: "f_1",
    conversationId: "c_1",
    currentStepIndex: cursor,
    loopStartIndex: loopStart,
    steps: steps.map((s, i) => ({
      id: `s_${i}`,
      flowId: "f_1",
      sequence: i,
      kind: s.kind,
      personaIds: s.personaIds,
      instruction: s.instruction ?? null,
    })),
  };
}

describe("serializePersonas with flow option (#236)", () => {
  it("emits a `flow` block when flow option is supplied, with steps in name form", () => {
    const ps: Persona[] = [
      persona({ id: "p_a", name: "Claudio" }),
      persona({ id: "p_b", name: "Geppetto" }),
    ];
    const flow = flowWithSteps([
      { kind: "user", personaIds: [] },
      { kind: "personas", personaIds: ["p_a"] },
      { kind: "personas", personaIds: ["p_b"], instruction: "be brief" },
    ]);
    const json = serializePersonas(ps, { flow });
    const parsed = JSON.parse(json) as {
      flow?: {
        currentStepIndex: number;
        loopStartIndex?: number;
        steps: Array<{ kind: string; personas: string[]; instruction?: string | null }>;
      };
    };
    expect(parsed.flow).toBeDefined();
    expect(parsed.flow?.steps).toHaveLength(3);
    expect(parsed.flow?.steps[1]?.kind).toBe("personas");
    expect(parsed.flow?.steps[1]?.personas).toEqual(["Claudio"]);
    expect(parsed.flow?.steps[2]?.personas).toEqual(["Geppetto"]);
    expect(parsed.flow?.steps[2]?.instruction).toBe("be brief");
  });

  it("emits per-persona roleLens with name keys (literal 'user' passes through)", () => {
    const ps: Persona[] = [
      persona({
        id: "p_a",
        name: "Claudio",
        roleLens: { user: "user", p_b: "user" },
      }),
      persona({
        id: "p_b",
        name: "Geppetto",
        roleLens: {},
      }),
    ];
    const json = serializePersonas(ps);
    const parsed = JSON.parse(json) as {
      personas: Array<{ name: string; roleLens?: Record<string, string> }>;
    };
    const claudio = parsed.personas.find((p) => p.name === "Claudio");
    expect(claudio?.roleLens).toEqual({ user: "user", Geppetto: "user" });
    // Geppetto's empty lens is omitted (matches snapshot's behavior).
    const geppetto = parsed.personas.find((p) => p.name === "Geppetto");
    expect(geppetto?.roleLens).toBeUndefined();
  });

  it("omits the `flow` field when no flow option is supplied (back-compat)", () => {
    const ps: Persona[] = [persona({ id: "p_a", name: "Alice" })];
    const json = serializePersonas(ps);
    const parsed = JSON.parse(json) as { flow?: unknown };
    expect(parsed.flow).toBeUndefined();
  });
});

describe("parsePersonasImport with flow + roleLens (#236)", () => {
  it("accepts an envelope with a `flow` block and exposes it on the parse result", () => {
    const r = parsePersonasImport(
      JSON.stringify({
        version: 1,
        personas: [{ name: "Alice", provider: "claude" }],
        flow: {
          currentStepIndex: 0,
          loopStartIndex: 0,
          steps: [
            { kind: "user", personas: [] },
            { kind: "personas", personas: ["Alice"], instruction: "go" },
          ],
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.flow).toBeDefined();
    expect(r.flow?.steps).toHaveLength(2);
    expect(r.flow?.steps[1]?.personas).toEqual(["Alice"]);
    expect(r.flow?.steps[1]?.instruction).toBe("go");
  });

  it("accepts an envelope without `flow` (legacy, pre-#236)", () => {
    const r = parsePersonasImport(
      JSON.stringify({
        version: 1,
        personas: [{ name: "Alice", provider: "claude" }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.flow).toBeUndefined();
  });

  it("accepts per-persona `roleLens`", () => {
    const r = parsePersonasImport(
      JSON.stringify({
        version: 1,
        personas: [
          {
            name: "Alice",
            provider: "claude",
            roleLens: { user: "user", Bob: "user" },
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.personas[0]?.roleLens).toEqual({ user: "user", Bob: "user" });
  });
});

describe("resolveImport carries flow + roleLens through (#236)", () => {
  it("threads flow through unchanged (caller resolves names → ids)", () => {
    const flow = {
      currentStepIndex: 0,
      loopStartIndex: 0,
      steps: [
        { kind: "user" as const, personas: [] },
        { kind: "personas" as const, personas: ["Bob"] },
      ],
    };
    const r = resolveImport([persona({ id: "p_a", name: "Alice" })], [imp({ name: "Bob" })], flow);
    expect(r.flow).toEqual(flow);
  });

  it("threads roleLens through on each created persona (names preserved as keys)", () => {
    const r = resolveImport(
      [persona({ id: "p_a", name: "Alice" })],
      [
        imp({ name: "Bob", roleLens: { user: "user", Alice: "user" } }),
      ],
    );
    expect(r.toCreate[0]?.roleLens).toEqual({ user: "user", Alice: "user" });
  });
});
