import { describe, it, expect } from "vitest";
import { redact } from "@/lib/security/redact";

describe("redact", () => {
  it("replaces generic sk- style keys", () => {
    const out = redact({ text: "key is sk-abcdefghijklmnopqrstuvwxyz please" });
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-abc");
  });

  it("replaces anthropic-style keys", () => {
    const out = redact({ text: "sk-ant-abcdefghijklmnopqrstuvwxyz123" });
    expect(out).toBe("[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const out = redact({ text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" });
    expect(out).toContain("[REDACTED]");
  });

  it("redacts exact known secrets supplied by caller", () => {
    const out = redact({ text: "abcd1234-myCustomToken-z", knownSecrets: ["myCustomToken"] });
    expect(out).toContain("[REDACTED]");
  });

  it("ignores secrets shorter than 8 chars (reduces false positives)", () => {
    const out = redact({ text: "hi there", knownSecrets: ["hi"] });
    expect(out).toBe("hi there");
  });
});
