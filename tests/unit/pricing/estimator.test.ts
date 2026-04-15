import { describe, it, expect } from "vitest";
import { estimateCost } from "@/lib/pricing";

describe("estimateCost", () => {
  it("computes USD from known model", () => {
    const r = estimateCost({
      provider: "claude",
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      estimated: false,
    });
    expect(r.usd).toBeCloseTo(3 + 0.5 * 15);
    expect(r.approximate).toBe(false);
  });

  it("marks approximate=true when usage was estimated", () => {
    const r = estimateCost({
      provider: "claude",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 0,
      estimated: true,
    });
    expect(r.approximate).toBe(true);
  });

  it("falls back to median for unknown model", () => {
    const r = estimateCost({
      provider: "openai",
      model: "gpt-unknown-7",
      inputTokens: 1_000_000,
      outputTokens: 0,
      estimated: false,
    });
    // Median of 2.5 and 0.15 = 1.325
    expect(r.usd).toBeCloseTo(1.325, 3);
    expect(r.approximate).toBe(true);
  });

  it("mock model is free", () => {
    const r = estimateCost({
      provider: "mock",
      model: "mock-1",
      inputTokens: 100_000,
      outputTokens: 100_000,
      estimated: false,
    });
    expect(r.usd).toBe(0);
  });
});
