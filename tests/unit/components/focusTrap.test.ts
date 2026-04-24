// #127 — focus-trap key-handling logic. Tests a pure helper so DOM is
// not required; the React hook wires the helper to the actual container.
import { describe, it, expect } from "vitest";
import { focusTrapAction } from "@/components/focusTrap";

function ev(
  key: string,
  mods: { shift?: boolean } = {},
): Pick<KeyboardEvent, "key" | "shiftKey"> {
  return { key, shiftKey: mods.shift ?? false };
}

describe("focusTrapAction", () => {
  it("returns 'close' on Escape", () => {
    expect(
      focusTrapAction(ev("Escape"), { onFirst: false, onLast: false, hasFocusables: true }),
    ).toBe("close");
  });

  it("wraps to first when Tab pressed on last focusable", () => {
    expect(
      focusTrapAction(ev("Tab"), { onFirst: false, onLast: true, hasFocusables: true }),
    ).toBe("wrap-to-first");
  });

  it("wraps to last when Shift+Tab pressed on first focusable", () => {
    expect(
      focusTrapAction(ev("Tab", { shift: true }), {
        onFirst: true,
        onLast: false,
        hasFocusables: true,
      }),
    ).toBe("wrap-to-last");
  });

  it("returns null for Tab in the middle of the dialog", () => {
    expect(
      focusTrapAction(ev("Tab"), { onFirst: false, onLast: false, hasFocusables: true }),
    ).toBeNull();
  });

  it("returns null for Shift+Tab in the middle of the dialog", () => {
    expect(
      focusTrapAction(ev("Tab", { shift: true }), {
        onFirst: false,
        onLast: false,
        hasFocusables: true,
      }),
    ).toBeNull();
  });

  it("wraps Tab on last→first even with a single focusable (same element)", () => {
    expect(
      focusTrapAction(ev("Tab"), { onFirst: true, onLast: true, hasFocusables: true }),
    ).toBe("wrap-to-first");
  });

  it("suppresses wrap when there are no focusables", () => {
    // A dialog with no focusable children shouldn't try to restore focus
    // to a non-existent element — the hook should just prevent default
    // but not attempt the wrap.
    expect(
      focusTrapAction(ev("Tab"), { onFirst: false, onLast: false, hasFocusables: false }),
    ).toBeNull();
  });

  it("ignores non-Tab, non-Escape keys", () => {
    expect(
      focusTrapAction(ev("a"), { onFirst: false, onLast: true, hasFocusables: true }),
    ).toBeNull();
    expect(
      focusTrapAction(ev("Enter"), { onFirst: true, onLast: false, hasFocusables: true }),
    ).toBeNull();
  });
});
