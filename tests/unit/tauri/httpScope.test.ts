// #297 — gatherProviderHosts() must enumerate every openai_compat host
// the app may call: the four built-in preset hosts (static URLs, some
// with {VAR} path placeholders) plus the user's custom preset base URLs.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { upsertCustomPreset } from "@/lib/providers/openaiCompatStorage";
import {
  gatherProviderHosts,
  originOf,
  registerHostBestEffort,
  __setImpl,
  __resetImpl,
} from "@/lib/tauri/httpScope";
import * as crashLog from "@/lib/observability/crashLog";

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

describe("registerHostBestEffort (#316)", () => {
  afterEach(() => {
    __resetImpl();
    vi.restoreAllMocks();
  });

  it("logs via backgroundTask and calls onError when registration fails", async () => {
    const logSpy = vi.spyOn(crashLog, "appendStructured").mockResolvedValue(undefined);
    __setImpl({
      registerHosts: async () => {
        throw new Error("scope denied");
      },
    });
    const warnings: string[] = [];
    registerHostBestEffort("https://attacker-or-typo.example", (m) => warnings.push(m));
    await new Promise((r) => setTimeout(r, 0));

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/provider calls may be blocked/i);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = (logSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.kind).toBe("background-task-failed");
    expect(arg.label).toMatch(/httpScope/i);
  });

  it("does not log or warn on success", async () => {
    const logSpy = vi.spyOn(crashLog, "appendStructured").mockResolvedValue(undefined);
    __setImpl({ registerHosts: async () => {} });
    const warnings: string[] = [];
    registerHostBestEffort("https://ok.example", (m) => warnings.push(m));
    await new Promise((r) => setTimeout(r, 0));
    expect(warnings).toEqual([]);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
