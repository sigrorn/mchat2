// Apertus → openai_compat (Infomaniak preset) auto-conversion (#255).
//
// The pure conversion shape is: every apertus persona becomes
// openai_compat with the Infomaniak built-in preset; apertusProductId
// moves to the global openai_compat config's PRODUCT_ID template var
// (handled by the caller — this file just tells you the value to write).
// Non-apertus personas pass through unchanged.
import { describe, it, expect } from "vitest";
import {
  convertApertusPersonaShape,
  type ConvertibleApertusInput,
} from "@/lib/conversations/migrateApertusToOpenaiCompat";

function makePersonaInput(over: Partial<ConvertibleApertusInput> = {}): ConvertibleApertusInput {
  return {
    provider: "apertus",
    apertusProductId: "prod_abc",
    openaiCompatPreset: null,
    modelOverride: "swiss-ai/Apertus-70B-Instruct-2509",
    ...over,
  };
}

describe("convertApertusPersonaShape (#255)", () => {
  it("rewrites provider apertus → openai_compat with the Infomaniak preset", () => {
    const r = convertApertusPersonaShape(makePersonaInput());
    expect(r.changed).toBe(true);
    expect(r.persona.provider).toBe("openai_compat");
    expect(r.persona.openaiCompatPreset).toEqual({ kind: "builtin", id: "infomaniak" });
  });

  it("clears apertusProductId from the persona row and surfaces it for the caller", () => {
    // The caller writes this into the global Infomaniak preset's
    // templateVars; the persona row no longer holds it.
    const r = convertApertusPersonaShape(makePersonaInput({ apertusProductId: "prod_xyz" }));
    expect(r.persona.apertusProductId).toBeNull();
    expect(r.productId).toBe("prod_xyz");
  });

  it("preserves the model override (Apertus model ids are valid Infomaniak model ids)", () => {
    const r = convertApertusPersonaShape(
      makePersonaInput({ modelOverride: "Llama-3.3-70B-Instruct" }),
    );
    expect(r.persona.modelOverride).toBe("Llama-3.3-70B-Instruct");
  });

  it("returns changed=false and leaves non-apertus personas alone", () => {
    const claudeInput: ConvertibleApertusInput = {
      provider: "claude",
      apertusProductId: null,
      openaiCompatPreset: null,
      modelOverride: "claude-opus-4-6",
    };
    const r = convertApertusPersonaShape(claudeInput);
    expect(r.changed).toBe(false);
    expect(r.persona).toEqual(claudeInput);
    expect(r.productId).toBeNull();
  });

  it("returns changed=false for personas already on openai_compat (idempotent)", () => {
    // A re-run after a conversion (or a snapshot whose origin already
    // converted before export) shouldn't double-convert or wipe an
    // existing preset assignment.
    const already: ConvertibleApertusInput = {
      provider: "openai_compat",
      apertusProductId: null,
      openaiCompatPreset: { kind: "builtin", id: "infomaniak" },
      modelOverride: "swiss-ai/Apertus-70B-Instruct-2509",
    };
    const r = convertApertusPersonaShape(already);
    expect(r.changed).toBe(false);
    expect(r.persona).toEqual(already);
    expect(r.productId).toBeNull();
  });

  it("handles missing productId gracefully (some legacy personas had it null)", () => {
    const r = convertApertusPersonaShape(makePersonaInput({ apertusProductId: null }));
    expect(r.changed).toBe(true);
    expect(r.persona.provider).toBe("openai_compat");
    expect(r.productId).toBeNull();
  });
});
