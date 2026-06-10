// ------------------------------------------------------------------
// Component: shell.open scheme validation test (#307, part of #115)
// Responsibility: The shell shim must open only http/https URLs in the
//                 system browser and reject everything else (file://,
//                 custom schemes, non-URLs) BEFORE invoking the plugin —
//                 belt-and-braces above the Tauri capability layer, so a
//                 compromised webview cannot use open() for protocol-
//                 handler / local-file attacks.
// Collaborators: src/lib/tauri/shell.
// ------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { shell, __setImpl, __resetImpl } from "@/lib/tauri/shell";

describe("shell.open scheme validation (#307)", () => {
  let opened: string[];
  beforeEach(() => {
    opened = [];
    __setImpl({ open: async (u) => void opened.push(u) });
  });
  afterEach(() => __resetImpl());

  it("opens http and https URLs", async () => {
    await shell.open("https://openrouter.ai/");
    await shell.open("http://example.com/path?q=1");
    expect(opened).toEqual(["https://openrouter.ai/", "http://example.com/path?q=1"]);
  });

  it("rejects file:// URLs and never reaches the plugin", async () => {
    await expect(shell.open("file:///C:/Windows")).rejects.toThrow();
    expect(opened).toEqual([]);
  });

  it("rejects custom schemes and non-URL strings", async () => {
    await expect(shell.open("javascript:alert(1)")).rejects.toThrow();
    await expect(shell.open("tel:+1234567")).rejects.toThrow();
    await expect(shell.open("mailto:a@b.com")).rejects.toThrow();
    await expect(shell.open("not a url")).rejects.toThrow();
    await expect(shell.open("")).rejects.toThrow();
    expect(opened).toEqual([]);
  });
});
