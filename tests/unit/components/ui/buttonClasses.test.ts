// #198 — design-primitive helpers for OutlineButton / PrimaryButton /
// DangerButton. The tripwire here is the "forgot text color" bug class
// from #172: outline buttons rendered low-contrast because the
// inline className strings omitted `text-neutral-700`. The helpers
// must always include the right text-color regardless of size.
import { describe, it, expect } from "vitest";
import {
  outlineButtonClass,
  primaryButtonClass,
  dangerButtonClass,
  type ButtonSize,
} from "@/components/ui/buttonClasses";

const SIZES: readonly ButtonSize[] = ["xs", "sm", "md", "lg"];

describe("outlineButtonClass", () => {
  it("always includes text-neutral-700 (anti-regression for #172)", () => {
    for (const s of SIZES) {
      expect(outlineButtonClass(s)).toContain("text-neutral-700");
    }
  });
  it("always includes the outline border", () => {
    for (const s of SIZES) {
      expect(outlineButtonClass(s)).toContain("border-neutral-300");
    }
  });
  it("always includes hover state", () => {
    for (const s of SIZES) {
      expect(outlineButtonClass(s)).toContain("hover:bg-neutral-100");
    }
  });
  it("includes the rounded base class", () => {
    expect(outlineButtonClass("md")).toContain("rounded");
  });
  it("appends extra classes when provided", () => {
    expect(outlineButtonClass("md", "ml-2 italic")).toContain("ml-2");
    expect(outlineButtonClass("md", "ml-2 italic")).toContain("italic");
  });
  it("varies sizing across variants", () => {
    expect(outlineButtonClass("xs")).toContain("text-xs");
    expect(outlineButtonClass("md")).toContain("text-sm");
    expect(outlineButtonClass("lg")).toContain("py-2");
  });
});

describe("primaryButtonClass", () => {
  it("always includes text-white", () => {
    for (const s of SIZES) {
      expect(primaryButtonClass(s)).toContain("text-white");
    }
  });
  it("always includes the dark background and hover state", () => {
    for (const s of SIZES) {
      expect(primaryButtonClass(s)).toContain("bg-neutral-900");
      expect(primaryButtonClass(s)).toContain("hover:bg-neutral-700");
    }
  });
  it("includes disabled-state opacity (matches existing call sites)", () => {
    expect(primaryButtonClass("md")).toContain("disabled:opacity-50");
  });
});

describe("dangerButtonClass", () => {
  it("always includes text-red-700", () => {
    for (const s of SIZES) {
      expect(dangerButtonClass(s)).toContain("text-red-700");
    }
  });
  it("always includes the red border and hover state", () => {
    for (const s of SIZES) {
      expect(dangerButtonClass(s)).toContain("border-red-600");
      expect(dangerButtonClass(s)).toContain("hover:bg-red-50");
    }
  });
});
