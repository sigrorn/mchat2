// #79 — //order command: show DAG execution order.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";
import { formatExecutionOrder } from "@/lib/commands/executionOrder";
import type { Persona } from "@/lib/types";

function persona(id: string, name: string, runsAfter: string[] = []): Persona {
  return {
    id,
    conversationId: "c_1",
    provider: "mock",
    name,
    nameSlug: name.toLowerCase(),
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    runsAfter,
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null,
  };
}

describe("parseCommand //order", () => {
  it("parses //order", () => {
    expect(parseCommand("//order")).toEqual({ kind: "order" });
  });

  it("rejects //order with arguments", () => {
    expect(parseCommand("//order foo").kind).toBe("error");
  });
});

describe("formatExecutionOrder (#79)", () => {
  it("no personas", () => {
    expect(formatExecutionOrder([])).toBe("order: no personas.");
  });

  it("all in parallel (no runsAfter edges)", () => {
    const ps = [persona("p_a", "alice"), persona("p_b", "bob"), persona("p_c", "carol")];
    expect(formatExecutionOrder(ps)).toBe("order: all in parallel.");
  });

  it("simple chain: a → b → c", () => {
    const ps = [
      persona("p_a", "alice"),
      persona("p_b", "bob", ["p_a"]),
      persona("p_c", "carol", ["p_b"]),
    ];
    const result = formatExecutionOrder(ps);
    expect(result).toContain("alice straight away");
    expect(result).toContain("bob after alice");
    expect(result).toContain("carol after bob");
  });

  it("AND-join: c after a + b", () => {
    const ps = [
      persona("p_a", "alice"),
      persona("p_b", "bob"),
      persona("p_c", "carol", ["p_a", "p_b"]),
    ];
    const result = formatExecutionOrder(ps);
    expect(result).toContain("alice, bob straight away");
    expect(result).toContain("carol after alice + bob");
  });

  it("single persona", () => {
    expect(formatExecutionOrder([persona("p_a", "alice")])).toBe("order: all in parallel.");
  });
});
