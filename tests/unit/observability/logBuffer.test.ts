// #129 — ring buffer that holds the last N stream-lifecycle events.
import { describe, it, expect } from "vitest";
import { createLogBuffer, type LogEvent } from "@/lib/observability/logBuffer";

function mkEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    ts: 1000,
    personaId: "p1",
    provider: "claude",
    model: "claude-3-5-sonnet",
    event: "open",
    statusOrReason: null,
    elapsedMs: null,
    bytes: null,
    ...overrides,
  };
}

describe("createLogBuffer", () => {
  it("records pushed events in order", () => {
    const buf = createLogBuffer(100);
    buf.push(mkEvent({ ts: 1 }));
    buf.push(mkEvent({ ts: 2 }));
    buf.push(mkEvent({ ts: 3 }));
    expect(buf.snapshot().map((e) => e.ts)).toEqual([1, 2, 3]);
  });

  it("caps the buffer at capacity, dropping oldest entries", () => {
    const buf = createLogBuffer(3);
    buf.push(mkEvent({ ts: 1 }));
    buf.push(mkEvent({ ts: 2 }));
    buf.push(mkEvent({ ts: 3 }));
    buf.push(mkEvent({ ts: 4 }));
    expect(buf.snapshot().map((e) => e.ts)).toEqual([2, 3, 4]);
  });

  it("filters by personaId", () => {
    const buf = createLogBuffer(100);
    buf.push(mkEvent({ personaId: "a", ts: 1 }));
    buf.push(mkEvent({ personaId: "b", ts: 2 }));
    buf.push(mkEvent({ personaId: "a", ts: 3 }));
    expect(buf.snapshot({ personaId: "a" }).map((e) => e.ts)).toEqual([1, 3]);
  });

  it("limits snapshot to the most recent N entries", () => {
    const buf = createLogBuffer(100);
    for (let i = 1; i <= 10; i++) buf.push(mkEvent({ ts: i }));
    expect(buf.snapshot({ limit: 3 }).map((e) => e.ts)).toEqual([8, 9, 10]);
  });

  it("clear() empties the buffer", () => {
    const buf = createLogBuffer(100);
    buf.push(mkEvent());
    buf.push(mkEvent());
    buf.clear();
    expect(buf.snapshot()).toEqual([]);
  });

  it("snapshot returns a copy (not a live view)", () => {
    const buf = createLogBuffer(100);
    buf.push(mkEvent({ ts: 1 }));
    const snap = buf.snapshot();
    buf.push(mkEvent({ ts: 2 }));
    expect(snap.length).toBe(1);
  });

  it("treats capacity 0 as 'never records'", () => {
    const buf = createLogBuffer(0);
    buf.push(mkEvent());
    expect(buf.snapshot()).toEqual([]);
  });
});
