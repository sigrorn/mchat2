// #299 — Artificial Analysis intelligence-index hint for the model picker.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl as setHttp, __resetImpl as resetHttp } from "@/lib/tauri/http";
import { __setImpl as setKc } from "@/lib/tauri/keychain";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import {
  normalizeModelKey,
  loadBenchmarks,
  lookupIntelligence,
  __clearBenchmarks,
} from "@/lib/providers/benchmarks";

interface MockHttpReq {
  url: string;
  headers: Record<string, string> | undefined;
}

let handle: TestDbHandle | null = null;
let httpCalls: MockHttpReq[];
let httpResponse: { status: number; body: string };
let kcStore: Map<string, string>;

function installHttpMock(): void {
  setHttp({
    async *streamSSE() {},
    async request(opts) {
      httpCalls.push({ url: opts.url, headers: opts.headers });
      return { status: httpResponse.status, body: httpResponse.body, headers: {} };
    },
  });
}

function installKeychainMock(): void {
  kcStore = new Map<string, string>();
  setKc({
    get: async (k) => kcStore.get(k) ?? null,
    set: async (k, v) => {
      kcStore.set(k, v);
    },
    remove: async (k) => {
      kcStore.delete(k);
    },
    list: async () => [...kcStore.keys()],
  });
}

// Build an AA-shaped /models response body.
function aaBody(
  entries: Array<{ slug: string; name?: string; intelligence?: number; creator?: string }>,
): string {
  return JSON.stringify({
    data: entries.map((e) => ({
      slug: e.slug,
      name: e.name ?? e.slug,
      model_creator: { slug: e.creator ?? "x" },
      evaluations: { artificial_analysis_intelligence_index: e.intelligence },
    })),
  });
}

const AA_KEY_SLOT = "artificial_analysis_api_key";

beforeEach(async () => {
  handle = await createTestDb();
  installHttpMock();
  installKeychainMock();
  httpCalls = [];
  httpResponse = { status: 200, body: aaBody([]) };
  __clearBenchmarks();
});
afterEach(() => {
  handle?.restore();
  handle = null;
  resetHttp();
});

describe("normalizeModelKey (#299)", () => {
  it("strips the vendor/ prefix", () => {
    expect(normalizeModelKey("anthropic/claude-sonnet-4")).toBe("claude-sonnet-4");
  });
  it("converts dots to hyphens", () => {
    expect(normalizeModelKey("gemini-2.5-pro")).toBe("gemini-2-5-pro");
  });
  it("drops a trailing date suffix", () => {
    expect(normalizeModelKey("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });
  it("drops a -latest suffix", () => {
    expect(normalizeModelKey("claude-sonnet-latest")).toBe("claude-sonnet");
  });
});

describe("benchmarks lookup (#299)", () => {
  it("does nothing and surfaces no error when no API key is set", async () => {
    await loadBenchmarks();
    expect(httpCalls).toHaveLength(0);
    expect(lookupIntelligence("openai_compat", "anthropic/claude-sonnet-4")).toBeUndefined();
  });

  it("fetches with the x-api-key header and matches an exact normalized slug", async () => {
    kcStore.set(AA_KEY_SLOT, "aa-key");
    httpResponse = { status: 200, body: aaBody([{ slug: "gemini-2-5-pro", intelligence: 70 }]) };
    await loadBenchmarks();
    expect(httpCalls).toHaveLength(1);
    expect(httpCalls[0]?.headers?.["x-api-key"]).toBe("aa-key");
    // Native id "gemini-2.5-pro" normalizes to AA's "gemini-2-5-pro".
    expect(lookupIntelligence("gemini", "gemini-2.5-pro")).toBe(70);
  });

  it("matches across a version-suffix difference (claude-sonnet-4 → claude-sonnet-4-6)", async () => {
    kcStore.set(AA_KEY_SLOT, "aa-key");
    httpResponse = { status: 200, body: aaBody([{ slug: "claude-sonnet-4-6", intelligence: 64 }]) };
    await loadBenchmarks();
    expect(lookupIntelligence("openai_compat", "anthropic/claude-sonnet-4")).toBe(64);
  });

  it("prefers the non-reasoning variant when a model has several entries", async () => {
    kcStore.set(AA_KEY_SLOT, "aa-key");
    httpResponse = {
      status: 200,
      body: aaBody([
        { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", intelligence: 60 },
        { slug: "claude-sonnet-4-6-thinking", name: "Claude Sonnet 4.6 (thinking)", intelligence: 72 },
      ]),
    };
    await loadBenchmarks();
    // mchat2 calls plain mode → the non-reasoning score (60), not 72.
    expect(lookupIntelligence("claude", "claude-sonnet-4-6")).toBe(60);
  });

  it("falls back to a reasoning variant when no plain entry exists", async () => {
    kcStore.set(AA_KEY_SLOT, "aa-key");
    httpResponse = {
      status: 200,
      body: aaBody([{ slug: "o3-mini-reasoning", name: "o3-mini (reasoning)", intelligence: 63 }]),
    };
    await loadBenchmarks();
    expect(lookupIntelligence("openai", "o3-mini-reasoning")).toBe(63);
  });

  it("serves the persisted cache after an in-memory clear even when the network fails", async () => {
    kcStore.set(AA_KEY_SLOT, "aa-key");
    httpResponse = { status: 200, body: aaBody([{ slug: "gpt-4o", intelligence: 50 }]) };
    await loadBenchmarks();
    expect(lookupIntelligence("openai", "gpt-4o")).toBe(50);

    // Simulate restart: in-memory gone, network down.
    __clearBenchmarks();
    httpResponse = { status: 500, body: "boom" };
    await loadBenchmarks();
    // Comes from the persisted slim blob, no throw.
    expect(lookupIntelligence("openai", "gpt-4o")).toBe(50);
  });
});
