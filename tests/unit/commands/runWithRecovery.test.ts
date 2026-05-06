// #267 follow-up — when a command's dispatch throws (the v2.67.1 mystery
// was a SQLITE_BUSY thrown from //pop's transaction), the Composer used
// to silently swallow the throw, leaving the textarea empty and no UI
// signal that anything failed. runWithRecovery wraps the dispatch in a
// try/catch and normalizes a thrown error into a CommandResult so the
// Composer's existing applyResult path restores the text and shows a
// hint, the same way an error-result CommandResult already does.
import { describe, it, expect } from "vitest";
import { runWithRecovery } from "@/lib/commands/runWithRecovery";
import type { CommandResult } from "@/lib/commands/handlers/types";

describe("runWithRecovery", () => {
  it("passes through a void result as an empty CommandResult", async () => {
    const r = await runWithRecovery("hello", async () => {
      // handler did its work and returned no directive.
    });
    expect(r).toEqual({});
  });

  it("passes through a CommandResult unchanged", async () => {
    const original: CommandResult = { restoreText: "//x", hint: "ok" };
    const r = await runWithRecovery("//x", async () => original);
    expect(r).toEqual(original);
  });

  it("recovers from a thrown Error: restoreText = raw, hint = 'Command failed: <message>'", async () => {
    const r = await runWithRecovery("//pop", async () => {
      throw new Error("database is locked");
    });
    expect(r).toEqual({
      restoreText: "//pop",
      hint: "Command failed: database is locked",
    });
  });

  it("recovers from a non-Error throw by stringifying it", async () => {
    const r = await runWithRecovery("//pop", async () => {
      throw "raw string thrown";
    });
    expect(r).toEqual({
      restoreText: "//pop",
      hint: "Command failed: raw string thrown",
    });
  });

  it("does not leak the rejection — caller can always await without try/catch", async () => {
    // The whole point of this helper: the call site never has to know
    // a command threw. If runWithRecovery itself rejected, we'd just be
    // pushing the try/catch one level out.
    await expect(
      runWithRecovery("//pop", async () => {
        throw new Error("boom");
      }),
    ).resolves.toBeDefined();
  });
});
