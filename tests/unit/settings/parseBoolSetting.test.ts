// #133 — shared parser for persisted boolean settings. Extracted so
// the stream/buffer toggle (#131) and the panel-collapse toggles
// (#133) share one rule for null/invalid/"true"/"false" handling.
import { describe, it, expect } from "vitest";
import { parseBoolSetting } from "@/lib/settings/parseBool";

describe("parseBoolSetting", () => {
  it("returns the default when the raw value is null", () => {
    expect(parseBoolSetting(null, true)).toBe(true);
    expect(parseBoolSetting(null, false)).toBe(false);
  });

  it("returns the default when the raw value is an empty string", () => {
    expect(parseBoolSetting("", true)).toBe(true);
    expect(parseBoolSetting("", false)).toBe(false);
  });

  it("returns true for the literal 'true'", () => {
    expect(parseBoolSetting("true", false)).toBe(true);
  });

  it("returns false for the literal 'false'", () => {
    expect(parseBoolSetting("false", true)).toBe(false);
  });

  it("returns the default for any other non-boolean string", () => {
    expect(parseBoolSetting("yes", true)).toBe(true);
    expect(parseBoolSetting("1", false)).toBe(false);
    expect(parseBoolSetting("nope", true)).toBe(true);
  });

  it("is case-sensitive — only lowercase literals match", () => {
    expect(parseBoolSetting("True", false)).toBe(false);
    expect(parseBoolSetting("FALSE", true)).toBe(true);
  });
});
