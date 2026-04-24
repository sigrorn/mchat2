// #131 — decide whether token events should be suppressed during
// streaming (content still accumulates; only the live per-token UI
// patching is silenced). Pure helper so the matrix is unit-testable.
import { describe, it, expect } from "vitest";
import { shouldBufferTokens } from "@/hooks/shouldBufferTokens";

describe("shouldBufferTokens", () => {
  it("lines + single target + stream mode → stream", () => {
    expect(
      shouldBufferTokens({ displayMode: "lines", multiTarget: false, streamResponses: true }),
    ).toBe(false);
  });

  it("lines + multi target + stream mode → stream", () => {
    expect(
      shouldBufferTokens({ displayMode: "lines", multiTarget: true, streamResponses: true }),
    ).toBe(false);
  });

  it("lines + single target + buffer mode → buffer (user override)", () => {
    expect(
      shouldBufferTokens({ displayMode: "lines", multiTarget: false, streamResponses: false }),
    ).toBe(true);
  });

  it("lines + multi target + buffer mode → buffer (user override)", () => {
    expect(
      shouldBufferTokens({ displayMode: "lines", multiTarget: true, streamResponses: false }),
    ).toBe(true);
  });

  it("cols + multi target → always buffer regardless of toggle (#16)", () => {
    expect(
      shouldBufferTokens({ displayMode: "cols", multiTarget: true, streamResponses: true }),
    ).toBe(true);
    expect(
      shouldBufferTokens({ displayMode: "cols", multiTarget: true, streamResponses: false }),
    ).toBe(true);
  });

  it("cols + single target + stream mode → stream (cols buffering only kicks in for multi)", () => {
    expect(
      shouldBufferTokens({ displayMode: "cols", multiTarget: false, streamResponses: true }),
    ).toBe(false);
  });

  it("cols + single target + buffer mode → buffer (user override)", () => {
    expect(
      shouldBufferTokens({ displayMode: "cols", multiTarget: false, streamResponses: false }),
    ).toBe(true);
  });
});
