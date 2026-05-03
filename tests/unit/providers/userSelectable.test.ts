// Hide mock from production dropdowns — issue #24.
// Hide native apertus from all dropdowns — issue #256 Phase A.
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

  it("excludes 'apertus' in both modes (#256 Phase A)", () => {
    // Apertus auto-converted to openai_compat + Infomaniak preset in
    // Phase 0; users wanting that endpoint pick the openai_compat
    // path. Hiding the legacy provider from new-persona dropdowns
    // closes the door to creating fresh apertus rows.
    expect(userSelectableProviderIds(false)).not.toContain("apertus");
    expect(userSelectableProviderIds(true)).not.toContain("apertus");
  });

  it("preserves the registry order (filtered for mock + apertus)", () => {
    const dev = userSelectableProviderIds(true);
    expect(dev).toEqual([...ALL_PROVIDER_IDS].filter((id) => id !== "apertus"));
  });

  it("non-filtered providers are present in both modes", () => {
    const prod = userSelectableProviderIds(false);
    expect(prod).toContain("claude");
    expect(prod).toContain("openai");
    expect(prod).toContain("openai_compat");
  });
});
