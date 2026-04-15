// Hide mock from production dropdowns — issue #24.
import { describe, it, expect } from "vitest";
import { userSelectableProviderIds } from "@/lib/providers/userSelectable";
import { ALL_PROVIDER_IDS } from "@/lib/providers/registry";

describe("userSelectableProviderIds", () => {
  it("excludes 'mock' in prod (includeMock=false)", () => {
    const ids = userSelectableProviderIds(false);
    expect(ids).not.toContain("mock");
  });

  it("includes 'mock' in dev (includeMock=true)", () => {
    const ids = userSelectableProviderIds(true);
    expect(ids).toContain("mock");
  });

  it("preserves the registry order (just filtered)", () => {
    const dev = userSelectableProviderIds(true);
    expect(dev).toEqual([...ALL_PROVIDER_IDS]);
  });

  it("non-mock providers are present in both modes", () => {
    const prod = userSelectableProviderIds(false);
    expect(prod).toContain("claude");
    expect(prod).toContain("openai");
  });
});
