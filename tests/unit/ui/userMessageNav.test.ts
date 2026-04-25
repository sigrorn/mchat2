// User-message navigation arrows — issue #137.
import { describe, it, expect } from "vitest";
import { computeScrollTarget, computeUserMsgNav } from "@/lib/ui/userMessageNav";

const u = (id: string, offsetTop: number) => ({ id, offsetTop });

describe("computeUserMsgNav", () => {
  it("disables both buttons when there are no user messages", () => {
    const r = computeUserMsgNav({
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
      userMessages: [],
    });
    expect(r.upDisabled).toBe(true);
    expect(r.downDisabled).toBe(true);
    expect(r.prevId).toBe(null);
    expect(r.nextId).toBe(null);
    expect(r.nextIsBottom).toBe(false);
  });

  it("scrolled above the only user message: up disabled, down targets it", () => {
    const r = computeUserMsgNav({
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
      userMessages: [u("m1", 600)],
    });
    expect(r.upDisabled).toBe(true);
    expect(r.prevId).toBe(null);
    expect(r.nextId).toBe("m1");
    expect(r.nextIsBottom).toBe(false);
    expect(r.downDisabled).toBe(false);
  });

  it("at the only user message (not at bottom): down scrolls to bottom", () => {
    const r = computeUserMsgNav({
      scrollTop: 600,
      scrollHeight: 2000,
      clientHeight: 500,
      userMessages: [u("m1", 600)],
    });
    expect(r.upDisabled).toBe(true);
    expect(r.nextId).toBe(null);
    expect(r.nextIsBottom).toBe(true);
    expect(r.downDisabled).toBe(false);
  });

  it("at bottom of chat: down disabled regardless of position of last user message", () => {
    const r = computeUserMsgNav({
      scrollTop: 1500,
      scrollHeight: 2000,
      clientHeight: 500,
      userMessages: [u("m1", 200), u("m2", 800)],
    });
    expect(r.downDisabled).toBe(true);
    expect(r.nextId).toBe(null);
    expect(r.nextIsBottom).toBe(false);
    expect(r.prevId).toBe("m2");
    expect(r.upDisabled).toBe(false);
  });

  it("between two user messages: prev = above, next = below", () => {
    const r = computeUserMsgNav({
      scrollTop: 500,
      scrollHeight: 3000,
      clientHeight: 500,
      userMessages: [u("m1", 100), u("m2", 400), u("m3", 800), u("m4", 1500)],
    });
    expect(r.prevId).toBe("m2");
    expect(r.nextId).toBe("m3");
    expect(r.nextIsBottom).toBe(false);
    expect(r.upDisabled).toBe(false);
    expect(r.downDisabled).toBe(false);
  });

  it("at last user message (not bottom): up = previous, down = scroll to bottom", () => {
    const r = computeUserMsgNav({
      scrollTop: 1500,
      scrollHeight: 3000,
      clientHeight: 500,
      userMessages: [u("m1", 100), u("m2", 700), u("m3", 1500)],
    });
    expect(r.prevId).toBe("m2");
    expect(r.nextId).toBe(null);
    expect(r.nextIsBottom).toBe(true);
    expect(r.downDisabled).toBe(false);
  });

  it("scrolled exactly at first user message offset: up disabled, down targets next", () => {
    const r = computeUserMsgNav({
      scrollTop: 100,
      scrollHeight: 3000,
      clientHeight: 500,
      userMessages: [u("m1", 100), u("m2", 700)],
    });
    expect(r.upDisabled).toBe(true);
    expect(r.prevId).toBe(null);
    expect(r.nextId).toBe("m2");
  });

  it("honors epsilon: positions within 1px treated as 'at'", () => {
    // scrollTop is 0.6px below m2's offsetTop — should still count as "at m2",
    // not "between m1 and m2".
    const r = computeUserMsgNav({
      scrollTop: 700.6,
      scrollHeight: 3000,
      clientHeight: 500,
      userMessages: [u("m1", 100), u("m2", 700), u("m3", 1500)],
    });
    expect(r.prevId).toBe("m1");
    expect(r.nextId).toBe("m3");
  });

  it("handles unsorted input by offsetTop", () => {
    const r = computeUserMsgNav({
      scrollTop: 500,
      scrollHeight: 3000,
      clientHeight: 500,
      userMessages: [u("m3", 800), u("m1", 100), u("m2", 400)],
    });
    expect(r.prevId).toBe("m2");
    expect(r.nextId).toBe("m3");
  });

  it("viewportTopOffset shifts the prev/next reference: when scrolled to (offsetTop - paddingTop), the current bubble is neither prev nor next", () => {
    // Padding-aware case: container has padding-top=12, helper landed
    // the bubble at scrollTop = 700 - 12 = 688. With viewportTopOffset=12,
    // the reference becomes 700 — exactly at the bubble. Prev = m1, Next
    // = m3. Without viewportTopOffset (0), Next would mistakenly be m2.
    const r = computeUserMsgNav({
      scrollTop: 688,
      scrollHeight: 3000,
      clientHeight: 500,
      userMessages: [u("m1", 100), u("m2", 700), u("m3", 1500)],
      viewportTopOffset: 12,
    });
    expect(r.prevId).toBe("m1");
    expect(r.nextId).toBe("m3");
  });

  it("viewportTopOffset defaults to 0 (legacy callers unchanged)", () => {
    const a = computeUserMsgNav({
      scrollTop: 500,
      scrollHeight: 3000,
      clientHeight: 500,
      userMessages: [u("m1", 100), u("m2", 700)],
    });
    const b = computeUserMsgNav({
      scrollTop: 500,
      scrollHeight: 3000,
      clientHeight: 500,
      userMessages: [u("m1", 100), u("m2", 700)],
      viewportTopOffset: 0,
    });
    expect(a).toEqual(b);
  });

  it("computeScrollTarget subtracts the container's top padding so the bubble's natural margin stays visible", () => {
    // Bubble at offsetTop=200 inside a container with padding-top=12.
    // Without the fix the scroll top would be 200 and the 12px of padding
    // above the bubble would be hidden — making it look glued to the
    // chat header.
    expect(computeScrollTarget(200, 12)).toBe(188);
  });

  it("computeScrollTarget never returns a negative scrollTop", () => {
    expect(computeScrollTarget(5, 12)).toBe(0);
    expect(computeScrollTarget(0, 12)).toBe(0);
  });

  it("at bottom + only one user message above: up reachable, down disabled", () => {
    const r = computeUserMsgNav({
      scrollTop: 1500,
      scrollHeight: 2000,
      clientHeight: 500,
      userMessages: [u("m1", 300)],
    });
    expect(r.prevId).toBe("m1");
    expect(r.upDisabled).toBe(false);
    expect(r.downDisabled).toBe(true);
    expect(r.nextId).toBe(null);
    expect(r.nextIsBottom).toBe(false);
  });
});
