// #67 — Show per-model token limit in the model picker.
import { describe, it, expect } from "vitest";
import { formatTokenLimit, type ModelInfo } from "@/lib/providers/models";

describe("formatTokenLimit (#67)", () => {
  it("formats 128000 as 128k", () => {
    expect(formatTokenLimit(128000)).toBe("128k");
  });

  it("formats 1048576 as 1049k", () => {
    expect(formatTokenLimit(1048576)).toBe("1049k");
  });

  it("formats 8192 as 8k", () => {
    expect(formatTokenLimit(8192)).toBe("8k");
  });

  it("formats undefined as empty", () => {
    expect(formatTokenLimit(undefined)).toBe("");
  });
});

describe("ModelInfo type", () => {
  it("can carry id and optional maxTokens", () => {
    const m: ModelInfo = { id: "gpt-4o", maxTokens: 128000 };
    expect(m.id).toBe("gpt-4o");
    expect(m.maxTokens).toBe(128000);
  });

  it("maxTokens is optional", () => {
    const m: ModelInfo = { id: "unknown-model" };
    expect(m.maxTokens).toBeUndefined();
  });
});
