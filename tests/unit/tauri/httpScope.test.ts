// #297 — gatherProviderHosts() must enumerate every openai_compat host
// the app may call: the four built-in preset hosts (static URLs, some
// with {VAR} path placeholders) plus the user's custom preset base URLs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { upsertCustomPreset } from "@/lib/providers/openaiCompatStorage";
import { gatherProviderHosts, originOf } from "@/lib/tauri/httpScope";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("originOf", () => {
  it("strips path + query, keeping scheme://host[:port]", () => {
    expect(originOf("https://openrouter.ai/api/v1/chat/completions")).toBe(
      "https://openrouter.ai",
    );
    expect(originOf("http://localhost:8000/v1/chat/completions")).toBe(
      "http://localhost:8000",
    );
  });

  it("tolerates {VAR} placeholders in the path (host still parses)", () => {
    expect(
      originOf("https://api.infomaniak.com/2/ai/{PRODUCT_ID}/openai/v1/chat/completions"),
    ).toBe("https://api.infomaniak.com");
  });

  it("returns null for non-URLs", () => {
    expect(originOf("not a url")).toBeNull();
  });
});

describe("gatherProviderHosts", () => {
  it("includes all built-in preset origins", async () => {
    const hosts = await gatherProviderHosts();
    expect(hosts).toContain("https://openrouter.ai");
    expect(hosts).toContain("https://oai.endpoints.kepler.ai.cloud.ovh.net");
    expect(hosts).toContain("https://openai.inference.de-txl.ionos.com");
    expect(hosts).toContain("https://api.infomaniak.com");
  });

  it("adds custom preset origins and de-duplicates", async () => {
    await upsertCustomPreset({
      name: "local-vllm",
      baseUrl: "http://localhost:8000/v1/chat/completions",
      extraHeaders: {},
      requiresKey: false,
      supportsUsageStream: true,
    });
    const hosts = await gatherProviderHosts();
    expect(hosts).toContain("http://localhost:8000");
    // No duplicates.
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});
