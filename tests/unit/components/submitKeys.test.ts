// Enter submits, Shift+Enter inserts newline — issue #5.
import { describe, it, expect } from "vitest";
import { shouldSubmit } from "@/components/composerKeys";

function ev(
  key: string,
  mods: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean } = {},
): Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"> {
  return {
    key,
    shiftKey: mods.shift ?? false,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    altKey: mods.alt ?? false,
  };
}

describe("shouldSubmit", () => {
  it("submits on plain Enter", () => {
    expect(shouldSubmit(ev("Enter"))).toBe(true);
  });
  it("submits on Ctrl+Enter (muscle-memory alias)", () => {
    expect(shouldSubmit(ev("Enter", { ctrl: true }))).toBe(true);
  });
  it("submits on Cmd+Enter (mac)", () => {
    expect(shouldSubmit(ev("Enter", { meta: true }))).toBe(true);
  });
  it("does NOT submit on Shift+Enter (newline insertion)", () => {
    expect(shouldSubmit(ev("Enter", { shift: true }))).toBe(false);
  });
  it("does NOT submit on Alt+Enter", () => {
    expect(shouldSubmit(ev("Enter", { alt: true }))).toBe(false);
  });
  it("ignores other keys", () => {
    expect(shouldSubmit(ev("a"))).toBe(false);
    expect(shouldSubmit(ev("Escape"))).toBe(false);
  });
});
