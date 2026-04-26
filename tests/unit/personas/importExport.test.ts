// Persona import/export (de)serialization — issue #22.
import { describe, it, expect } from "vitest";
import {
  serializePersonas,
  parsePersonasImport,
  resolveImport,
  type ExportedPersona,
} from "@/lib/personas/importExport";
import type { Persona } from "@/lib/types";

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
    runsAfter: over.runsAfter ?? [],
    deletedAt: over.deletedAt ?? null,
    apertusProductId: over.apertusProductId ?? null,
    visibilityDefaults: over.visibilityDefaults ?? {}, openaiCompatPreset: null,
  };
}

describe("serializePersonas", () => {
  it("emits version 1 envelope and resolves runsAfter to a name", () => {
    const ps: Persona[] = [
      persona({ id: "p_a", name: "Alice", systemPromptOverride: "be brief" }),
      persona({ id: "p_b", name: "Bob", runsAfter: ["p_a"] }),
    ];
    const json = serializePersonas(ps);
    const parsed = JSON.parse(json) as { version: number; personas: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.personas).toHaveLength(2);
    const second = parsed.personas[1] as { name: string; runsAfter: string[] };
    expect(second.name).toBe("Bob");
    expect(second.runsAfter).toEqual(["Alice"]);
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
    runsAfter: over.runsAfter ?? [],
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
