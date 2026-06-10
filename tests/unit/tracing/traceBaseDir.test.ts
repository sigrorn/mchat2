// ------------------------------------------------------------------
// Component: Trace base-dir resolver test (#305)
// Responsibility: The sink path-resolution must fall back to the app-
//                 data dir when no working dir is configured (fresh
//                 profile), and honor an explicit working dir otherwise.
//                 This is the prerequisite behaviour for narrowing the
//                 fs capability off home-wide access (#306).
// Collaborators: src/lib/tracing/traceBaseDir.
// ------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { resolveTraceBaseDir } from "@/lib/tracing/traceBaseDir";

describe("resolveTraceBaseDir (#305)", () => {
  const stubAppData = async (): Promise<string> => "/app/data/dir";

  it("falls back to the app-data dir when no working dir is set", async () => {
    expect(await resolveTraceBaseDir(null, stubAppData)).toBe("/app/data/dir");
    expect(await resolveTraceBaseDir(undefined, stubAppData)).toBe("/app/data/dir");
  });

  it("treats blank/whitespace-only working dir as unset (fallback)", async () => {
    expect(await resolveTraceBaseDir("", stubAppData)).toBe("/app/data/dir");
    expect(await resolveTraceBaseDir("   ", stubAppData)).toBe("/app/data/dir");
  });

  it("honors an explicit working dir, trimmed", async () => {
    expect(await resolveTraceBaseDir("/my/dir", stubAppData)).toBe("/my/dir");
    expect(await resolveTraceBaseDir("  /my/dir  ", stubAppData)).toBe("/my/dir");
  });

  it("does not call the app-data resolver when a working dir is present", async () => {
    let called = false;
    const spy = async (): Promise<string> => {
      called = true;
      return "/app/data/dir";
    };
    await resolveTraceBaseDir("/explicit", spy);
    expect(called).toBe(false);
  });
});
