// ------------------------------------------------------------------
// Component: fs capability scope guard (#306, part of #115)
// Responsibility: Lock in that the Tauri fs capability does NOT grant
//                 home-wide recursive read/write. Combined with a
//                 renderer that renders LLM-controlled content, home-wide
//                 fs access turns any XSS into a full local-file
//                 compromise. After #305 traces default to $APPDATA, so
//                 the only legitimate consumers are $APPDATA (static
//                 scope) and dialog-picked paths (runtime scope). This
//                 guard fails the build if the broad grant is reintroduced.
// Collaborators: src-tauri/capabilities/default.json.
// ------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("fs capability scope (#306)", () => {
  const conf = JSON.parse(
    readFileSync(join(process.cwd(), "src-tauri/capabilities/default.json"), "utf8"),
  ) as { permissions: unknown[] };

  // Flatten permission identifiers (entries are either a string or an
  // object with an `identifier` field plus extra scope config).
  const ids = conf.permissions.map((p) =>
    typeof p === "string" ? p : (p as { identifier?: string }).identifier,
  );

  it("does not grant home-wide recursive read/write", () => {
    expect(ids).not.toContain("fs:allow-home-read-recursive");
    expect(ids).not.toContain("fs:allow-home-write-recursive");
  });

  it("keeps the $APPDATA fs:scope so app-data files (incl. traces) work", () => {
    const scope = conf.permissions.find(
      (p) => typeof p === "object" && (p as { identifier?: string }).identifier === "fs:scope",
    ) as { allow?: { path: string }[] } | undefined;
    expect(scope).toBeDefined();
    const paths = (scope?.allow ?? []).map((a) => a.path);
    expect(paths).toContain("$APPDATA/**");
  });
});
