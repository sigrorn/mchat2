// #128 (partial) — the comparator that decides whether a MessageBubble
// can skip re-render when its parent re-renders on streaming ticks.
// Pure helper kept out of the component so it can be unit-tested.
import { describe, it, expect } from "vitest";
import type { Message, Persona } from "@/lib/types";
import { areBubblePropsEqual, type BubbleProps } from "@/components/messageBubbleMemo";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    conversationId: "c1",
    role: "assistant",
    content: "hello",
    provider: "claude",
    model: "claude-3-5-sonnet",
    personaId: "p1",
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    createdAt: 1,
    index: 5,
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
    ...overrides,
  };
}

function makeProps(overrides: Partial<BubbleProps> = {}): BubbleProps {
  const personas: readonly Persona[] = [];
  return {
    message: makeMessage(),
    personas,
    userNumber: null,
    excluded: false,
    ...overrides,
  };
}

describe("areBubblePropsEqual", () => {
  it("returns true for identical props", () => {
    const p = makeProps();
    expect(areBubblePropsEqual(p, p)).toBe(true);
  });

  it("returns true when only callback identity differs", () => {
    const prev = makeProps({ onRetry: () => {}, onEdit: () => {} });
    const next = makeProps({
      message: prev.message,
      personas: prev.personas,
      onRetry: () => {},
      onEdit: () => {},
    });
    expect(areBubblePropsEqual(prev, next)).toBe(true);
  });

  it("returns false when message content changes (streaming tick)", () => {
    const prev = makeProps();
    const next = makeProps({ message: makeMessage({ content: "hello world" }) });
    expect(areBubblePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when errorMessage changes", () => {
    const prev = makeProps();
    const next = makeProps({ message: makeMessage({ errorMessage: "boom" }) });
    expect(areBubblePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when excluded flips", () => {
    const prev = makeProps({ excluded: false });
    const next = makeProps({ excluded: true });
    expect(areBubblePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when userNumber changes", () => {
    const prev = makeProps({ userNumber: 1 });
    const next = makeProps({ userNumber: 2 });
    expect(areBubblePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when pinned flips", () => {
    const prev = makeProps();
    const next = makeProps({ message: makeMessage({ pinned: true }) });
    expect(areBubblePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when addressedTo changes (affects header)", () => {
    const prev = makeProps({ message: makeMessage({ addressedTo: ["a"] }) });
    const next = makeProps({ message: makeMessage({ addressedTo: ["a", "b"] }) });
    expect(areBubblePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when personas reference changes", () => {
    const prev = makeProps({ personas: [] });
    // New reference — persona data might have changed (rename, color).
    // Safer to re-render than to show a stale persona header.
    const next = makeProps({ personas: [] as readonly Persona[] });
    expect(areBubblePropsEqual(prev, next)).toBe(prev.personas === next.personas);
  });

  it("returns false when onEdit presence flips (user→assistant role swap)", () => {
    const prev = makeProps({ onEdit: () => {} });
    const next = makeProps({ message: prev.message, personas: prev.personas });
    expect(areBubblePropsEqual(prev, next)).toBe(false);
  });
});
