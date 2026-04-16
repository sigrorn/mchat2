// Font-zoom step helper — issue #50.
import { describe, it, expect } from "vitest";
import { SCALE_STEPS, nextScale, DEFAULT_SCALE } from "@/lib/ui/fontScale";

describe("fontScale", () => {
  it("default is 1.0 (100%)", () => {
    expect(DEFAULT_SCALE).toBe(1);
  });

  it("steps cover the documented range and include 1.0", () => {
    expect(SCALE_STEPS).toContain(1);
    expect(SCALE_STEPS[0]).toBeLessThan(1);
    expect(SCALE_STEPS[SCALE_STEPS.length - 1]).toBeGreaterThan(1);
  });

  it("nextScale('up') moves to the next higher step", () => {
    expect(nextScale(1, "up")).toBeGreaterThan(1);
    expect(nextScale(1, "up")).toBe(SCALE_STEPS[SCALE_STEPS.indexOf(1) + 1]);
  });

  it("nextScale('down') moves to the next lower step", () => {
    expect(nextScale(1, "down")).toBeLessThan(1);
    expect(nextScale(1, "down")).toBe(SCALE_STEPS[SCALE_STEPS.indexOf(1) - 1]);
  });

  it("nextScale clamps at the extremes", () => {
    const max = SCALE_STEPS[SCALE_STEPS.length - 1]!;
    expect(nextScale(max, "up")).toBe(max);
    const min = SCALE_STEPS[0]!;
    expect(nextScale(min, "down")).toBe(min);
  });

  it("nextScale('reset') returns the default", () => {
    expect(nextScale(1.5, "reset")).toBe(1);
    expect(nextScale(0.8, "reset")).toBe(1);
  });

  it("snaps an unknown / off-step value to the nearest step on 'up'/'down'", () => {
    // If somehow a stale value outside the step list lands in state,
    // the next up/down should still produce a valid step.
    const r = nextScale(1.05, "up");
    expect(SCALE_STEPS).toContain(r);
    expect(r).toBeGreaterThan(1.05);
  });
});
