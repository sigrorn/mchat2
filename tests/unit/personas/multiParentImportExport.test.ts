// #66 — Multi-parent runs_after in legacy import payloads.
//
// #241 Phase C dropped runs_after from disk and from modern exports.
// The parser still understands runs_after on input (so legacy files
// import cleanly), and resolveImport still resolves multi-parent
// arrays — fileOps then forwards the resolved set to the auto-
// migration as a transient map. These tests cover that surface.
import { describe, it, expect } from "vitest";
import {
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
    deletedAt: over.deletedAt ?? null,
    visibilityDefaults: over.visibilityDefaults ?? {},
    openaiCompatPreset: null,
    roleLens: {},
  };
}

function imp(over: Partial<ExportedPersona> & { name: string }): ExportedPersona {
  return {
    name: over.name,
    provider: over.provider ?? "claude",
    systemPromptOverride: over.systemPromptOverride ?? null,
    modelOverride: over.modelOverride ?? null,
    colorOverride: over.colorOverride ?? null,
    visibilityDefaults: over.visibilityDefaults ?? {},
    ...(over.runsAfter !== undefined ? { runsAfter: over.runsAfter } : {}),
  };
}

describe("parsePersonasImport multi-parent (#66, legacy compat)", () => {
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

describe("resolveImport multi-parent (#66, legacy compat)", () => {
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
