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

  // #309: token in a generic shape so this exercises the new key=/header
  // patterns specifically, not the existing AIza/sk- key shapes.
  it("masks key=<token> in query strings (#309)", () => {
    const out = redact({
      text: "https://host/v1beta/models/x:streamGenerateContent?alt=sse&key=abcDEF1234567890ghiJKL",
    });
    expect(out).not.toContain("abcDEF1234567890ghiJKL");
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("alt=sse");
  });

  it("masks x-goog-api-key header lines (#309)", () => {
    const out = redact({ text: "x-goog-api-key: abcDEF1234567890ghiJKL" });
    expect(out).not.toContain("abcDEF1234567890ghiJKL");
    expect(out).toContain("[REDACTED]");
  });

  it("does not redact innocuous '...key=' substrings without a query delimiter", () => {
    const out = redact({ text: "monkey=5 donkey=7" });
    expect(out).toBe("monkey=5 donkey=7");
  });
});
