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

  it("does not contain 'apertus' (#257 Phase B removed it from the registry)", () => {
    // Phase A filtered the runtime list; Phase B removed apertus from
    // ProviderId entirely. The literal isn't even in ALL_PROVIDER_IDS
    // any more, so this assertion now reflects a structural absence
    // rather than a runtime filter.
    expect(userSelectableProviderIds(false)).not.toContain("apertus" as never);
    expect(userSelectableProviderIds(true)).not.toContain("apertus" as never);
  });

  it("preserves the registry order (filtered for mock only after #257)", () => {
    const dev = userSelectableProviderIds(true);
    expect(dev).toEqual([...ALL_PROVIDER_IDS]);
  });

  it("non-filtered providers are present in both modes", () => {
    const prod = userSelectableProviderIds(false);
    expect(prod).toContain("claude");
    expect(prod).toContain("openai");
    expect(prod).toContain("openai_compat");
  });
});
