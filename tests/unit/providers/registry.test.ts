import { describe, it, expect } from "vitest";
import {
  PROVIDER_REGISTRY,
  ALL_PROVIDER_IDS,
  PREFIX_TO_PROVIDER,
  PROVIDER_COLORS,
  RESERVED_PERSONA_NAMES,
  isReservedName,
  providerForPrefix,
} from "@/lib/providers";

describe("provider registry", () => {
  it("has entries for every listed id", () => {
    for (const id of ALL_PROVIDER_IDS) {
      expect(PROVIDER_REGISTRY[id].id).toBe(id);
    }
  });

  it("prefixes are unique", () => {
    const prefixes = ALL_PROVIDER_IDS.map((id) => PROVIDER_REGISTRY[id].prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("derived prefix map round-trips", () => {
    for (const id of ALL_PROVIDER_IDS) {
      const pfx = PROVIDER_REGISTRY[id].prefix;
      expect(PREFIX_TO_PROVIDER.get(pfx)).toBe(id);
      expect(providerForPrefix(pfx.toUpperCase())).toBe(id);
    }
  });

  it("colors cover all providers", () => {
    for (const id of ALL_PROVIDER_IDS) {
      expect(PROVIDER_COLORS[id]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("reserves all prefixes plus all/others", () => {
    expect(isReservedName("all")).toBe(true);
    expect(isReservedName("others")).toBe(true);
    expect(RESERVED_PERSONA_NAMES.has("claude")).toBe(true);
    expect(isReservedName("alice")).toBe(false);
  });
});
