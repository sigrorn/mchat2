// #270 — backgroundTask wraps a fire-and-forget async write with
// error capture: it must NOT propagate, must NOT silently swallow.
// Failures land in a structured log line so a future user complaint
// ("my selection didn't persist") has a forensic trail.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { backgroundTask } from "@/lib/observability/backgroundTask";
import * as crashLog from "@/lib/observability/crashLog";

describe("backgroundTask (#270)", () => {
  beforeEach(() => {
    vi.spyOn(crashLog, "appendStructured").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns void synchronously and runs the async fn in the background", async () => {
    let ran = false;
    const ret = backgroundTask("noop", async () => {
      ran = true;
    });
    expect(ret).toBeUndefined();
    // Microtask flush.
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toBe(true);
  });

  it("does NOT propagate errors from the wrapped fn", async () => {
    // Critically: the caller does not see the rejection. A bare
    // `void asyncFn()` would surface as unhandledrejection; the helper
    // catches it.
    const promise = backgroundTask("expect-throw", async () => {
      throw new Error("boom");
    });
    expect(promise).toBeUndefined();
    // Wait for the catch handler.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("logs failures with kind=background-task-failed, label, error message, stack", async () => {
    backgroundTask("setSelection", async () => {
      throw new Error("DB locked");
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(crashLog.appendStructured).toHaveBeenCalledTimes(1);
    const arg = (crashLog.appendStructured as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0];
    expect(arg.kind).toBe("background-task-failed");
    expect(arg.label).toBe("setSelection");
    expect(arg.error).toBe("DB locked");
    expect(arg.stack).toBeTypeOf("string");
    expect(typeof arg.ts).toBe("number");
  });

  it("coerces non-Error throws to a string error and omits stack", async () => {
    backgroundTask("string-throw", async () => {
      throw "literal-string";
    });
    await new Promise((r) => setTimeout(r, 0));
    const arg = (crashLog.appendStructured as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0];
    expect(arg.error).toBe("literal-string");
    expect(arg.stack).toBeUndefined();
  });

  it("does not log when the fn resolves successfully", async () => {
    backgroundTask("ok", async () => 42);
    await new Promise((r) => setTimeout(r, 0));
    expect(crashLog.appendStructured).not.toHaveBeenCalled();
  });
});
