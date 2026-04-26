// #66 — Multi-parent runsAfter in import/export.
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

describe("serializePersonas multi-parent (#66)", () => {
  it("resolves multi-parent runsAfter ids to names", () => {
    const ps: Persona[] = [
      persona({ id: "p_a", name: "Alice" }),
      persona({ id: "p_b", name: "Bob" }),
      persona({ id: "p_c", name: "Carol", runsAfter: ["p_a", "p_b"] }),
    ];
    const json = serializePersonas(ps);
    const parsed = JSON.parse(json) as { personas: { name: string; runsAfter: string[] }[] };
    const carol = parsed.personas.find((p) => p.name === "Carol");
    expect(carol?.runsAfter).toEqual(["Alice", "Bob"]);
  });
});

describe("parsePersonasImport multi-parent (#66)", () => {
  it("accepts runsAfter as an array of names", () => {
    const r = parsePersonasImport(
      JSON.stringify({
        version: 1,
        personas: [
          { name: "Alice", provider: "claude" },
          { name: "Bob", provider: "claude" },
          { name: "Carol", provider: "claude", runsAfter: ["Alice", "Bob"] },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.personas[2]?.runsAfter).toEqual(["Alice", "Bob"]);
  });

  it("backward compat: accepts runsAfter as a single string", () => {
    const r = parsePersonasImport(
      JSON.stringify({
        version: 1,
        personas: [
          { name: "Alice", provider: "claude" },
          { name: "Bob", provider: "claude", runsAfter: "Alice" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.personas[1]?.runsAfter).toEqual(["Alice"]);
  });
});

describe("resolveImport multi-parent (#66)", () => {
  it("resolves multi-parent runsAfter by name", () => {
    const existing: Persona[] = [persona({ id: "p_a", name: "Alice" })];
    const r = resolveImport(existing, [
      imp({ name: "Bob" }),
      imp({ name: "Carol", runsAfter: ["Alice", "Bob"] }),
    ]);
    const carol = r.toCreate.find((p) => p.name === "Carol");
    expect(carol?.runsAfter).toEqual(["Alice", "Bob"]);
  });

  it("filters out unknown names from multi-parent runsAfter", () => {
    const existing: Persona[] = [persona({ id: "p_a", name: "Alice" })];
    const r = resolveImport(existing, [imp({ name: "Bob", runsAfter: ["Alice", "Ghost"] })]);
    expect(r.toCreate[0]?.runsAfter).toEqual(["Alice"]);
  });
});
