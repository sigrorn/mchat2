// ------------------------------------------------------------------
// Component: Model lister
// Responsibility: Return the list of known model ids for a provider.
//                 Prefers a live /models query with the user's API key
//                 so the picker always reflects what the account can
//                 actually invoke. Falls back to the static pricing
//                 table when the live call fails or there's no key.
// Collaborators: tauri/http.request, providers/registry.
// ------------------------------------------------------------------

import type { Persona, ProviderId } from "../types";
import { PRICING } from "../pricing/table";
import { request, HttpError } from "../tauri/http";
import { resolveOpenAICompatPreset } from "./openaiCompatResolver";

export interface ModelInfo {
  id: string;
  maxTokens?: number;
}

export function formatTokenLimit(tokens: number | undefined): string {
  if (tokens === undefined) return "";
  return `${Math.round(tokens / 1000)}k`;
}

interface OpenAICompatModel {
  id: string;
  context_window?: number;
}
interface OpenAICompatModelsResponse {
  data?: OpenAICompatModel[];
}
interface AnthropicModelsResponse {
  data?: { id: string }[];
}
interface GeminiModel {
  name: string;
  inputTokenLimit?: number;
}
interface GeminiModelsResponse {
  models?: GeminiModel[];
}
interface MistralModel {
  id: string;
  max_context_length?: number;
  capabilities?: { completion_chat?: boolean };
}
interface MistralModelsResponse {
  data?: MistralModel[];
}

const BLOCKLIST_PREFIXES = ["dall-e", "whisper", "tts", "text-embedding", "babbage", "davinci"];

const EMBED_KEYWORDS = ["embed", "embedding"];

export function isChatModel(provider: ProviderId, id: string): boolean {
  const lc = id.toLowerCase();
  switch (provider) {
    case "claude":
      return true;
    case "openai":
    case "apertus":
      return !BLOCKLIST_PREFIXES.some((p) => lc.startsWith(p));
    case "gemini":
      return !EMBED_KEYWORDS.some((k) => lc.includes(k));
    case "mistral":
      return !EMBED_KEYWORDS.some((k) => lc.includes(k));
    case "perplexity":
      return true;
    case "openai_compat":
      // Preset-routed; the user types a free-form model id, so chat-
      // gating is best-effort: keep everything that isn't an obvious
      // embedding/TTS model.
      return !EMBED_KEYWORDS.some((k) => lc.includes(k));
    case "mock":
      return true;
  }
}

// #203: extras carry per-provider context for model listing — the
// Apertus product id (legacy) and the persona's openai_compat preset.
// Threaded straight into fetchProviderModelInfos.
export interface ListModelInfosExtra {
  apertusProductId?: string | null;
  openaiCompatPreset?: Persona["openaiCompatPreset"];
}

const infoCache = new Map<string, { at: number; infos: ModelInfo[] }>();
const TTL_MS = 10 * 60_000;

// Test seam — clear the per-provider model cache between cases so a
// successful first call doesn't poison a follow-up that simulates a
// failure on the same cache key.
export function __clearModelCache(): void {
  infoCache.clear();
}

function cacheKeyFor(provider: ProviderId, extra: ListModelInfosExtra | undefined): string {
  if (provider === "apertus") return `apertus:${extra?.apertusProductId ?? ""}`;
  if (provider === "openai_compat") {
    const p = extra?.openaiCompatPreset;
    if (!p) return "openai_compat:none";
    return p.kind === "builtin"
      ? `openai_compat:builtin:${p.id}`
      : `openai_compat:custom:${p.name}`;
  }
  return provider;
}

export async function listModels(
  provider: ProviderId,
  apiKey: string | null,
  extra?: ListModelInfosExtra,
): Promise<string[]> {
  const infos = await listModelInfos(provider, apiKey, extra);
  return infos.map((m) => m.id);
}

export async function listModelInfos(
  provider: ProviderId,
  apiKey: string | null,
  extra?: ListModelInfosExtra,
): Promise<ModelInfo[]> {
  const cacheKey = cacheKeyFor(provider, extra);
  const cached = infoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.infos;

  const fallback: ModelInfo[] = Object.keys(PRICING[provider] ?? {}).map((id) => ({ id }));
  // #203: openai_compat resolves its api key through the preset, not
  // through the top-level keychain — so a missing top-level apiKey is
  // fine here. The other providers still need a key to query their
  // /models endpoints.
  if (!apiKey && provider !== "openai_compat") return fallback;

  try {
    const raw = await fetchProviderModelInfos(provider, apiKey, extra);
    const filtered = raw.filter((m) => isChatModel(provider, m.id));
    if (filtered.length === 0) return fallback;
    const sorted = dedup(filtered).sort((a, b) => a.id.localeCompare(b.id));
    infoCache.set(cacheKey, { at: Date.now(), infos: sorted });
    return sorted;
  } catch {
    return fallback;
  }
}

function dedup(infos: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  return infos.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

async function fetchProviderModelInfos(
  provider: ProviderId,
  apiKey: string | null,
  extra?: ListModelInfosExtra,
): Promise<ModelInfo[]> {
  switch (provider) {
    case "openai":
      return openAICompatList("https://api.openai.com/v1/models", apiKey ?? "");
    case "perplexity":
      return [];
    case "mistral":
      return mistralList(apiKey ?? "");
    case "apertus": {
      const pid = extra?.apertusProductId?.trim();
      if (!pid) return [];
      return openAICompatList(
        `https://api.infomaniak.com/2/ai/${encodeURIComponent(pid)}/openai/v1/models`,
        apiKey ?? "",
      );
    }
    case "claude":
      return anthropicList(apiKey ?? "");
    case "gemini":
      return geminiList(apiKey ?? "");
    case "openai_compat":
      return openaiCompatPresetList(extra?.openaiCompatPreset);
    case "mock":
      return [];
  }
}

async function openAICompatList(url: string, apiKey: string): Promise<ModelInfo[]> {
  const res = await request({
    url,
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (res.status >= 400) throw new HttpError(res.status, res.body);
  const parsed = JSON.parse(res.body) as OpenAICompatModelsResponse;
  return (
    parsed.data?.map((d) => ({
      id: d.id,
      ...(d.context_window ? { maxTokens: d.context_window } : {}),
    })) ?? []
  );
}

// #203: derive the /v1/models URL from the resolved chat URL by
// replacing the trailing "/chat/completions" with "/models". Holds
// for every preset shipping today (Infomaniak, OpenRouter, OVHcloud,
// IONOS) and for the OpenAI-spec custom URLs users typically enter.
// Returns null if the chat URL doesn't end in /chat/completions —
// in that case the caller falls back to an empty list (free-text input).
function deriveModelsUrl(chatUrl: string): string | null {
  const suffix = "/chat/completions";
  if (!chatUrl.endsWith(suffix)) return null;
  return chatUrl.slice(0, -suffix.length) + "/models";
}

async function openaiCompatPresetList(
  preset: Persona["openaiCompatPreset"] | undefined,
): Promise<ModelInfo[]> {
  if (!preset) return [];
  const resolved = await resolveOpenAICompatPreset(preset);
  if (!resolved) return [];
  const url = deriveModelsUrl(resolved.url);
  if (!url) return [];
  // Build headers matching the chat-completions request shape: bearer
  // auth when a key is set, plus the preset's extraHeaders (OpenRouter
  // wants HTTP-Referer / X-Title even for the model listing call).
  const headers: Record<string, string> = { ...resolved.extraHeaders };
  if (resolved.apiKey) headers.authorization = `Bearer ${resolved.apiKey}`;
  const res = await request({ url, method: "GET", headers });
  if (res.status >= 400) throw new HttpError(res.status, res.body);
  const parsed = JSON.parse(res.body) as OpenAICompatModelsResponse;
  return (
    parsed.data?.map((d) => ({
      id: d.id,
      ...(d.context_window ? { maxTokens: d.context_window } : {}),
    })) ?? []
  );
}

async function anthropicList(apiKey: string): Promise<ModelInfo[]> {
  const res = await request({
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (res.status >= 400) throw new HttpError(res.status, res.body);
  const parsed = JSON.parse(res.body) as AnthropicModelsResponse;
  return parsed.data?.map((d) => ({ id: d.id })) ?? [];
}

async function mistralList(apiKey: string): Promise<ModelInfo[]> {
  const res = await request({
    url: "https://api.mistral.ai/v1/models",
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (res.status >= 400) throw new HttpError(res.status, res.body);
  const parsed = JSON.parse(res.body) as MistralModelsResponse;
  return (
    parsed.data?.map((d) => ({
      id: d.id,
      ...(d.max_context_length ? { maxTokens: d.max_context_length } : {}),
    })) ?? []
  );
}

async function geminiList(apiKey: string): Promise<ModelInfo[]> {
  const res = await request({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    method: "GET",
  });
  if (res.status >= 400) throw new HttpError(res.status, res.body);
  const parsed = JSON.parse(res.body) as GeminiModelsResponse;
  return (
    parsed.models?.map((m) => ({
      id: m.name.replace(/^models\//, ""),
      ...(m.inputTokenLimit ? { maxTokens: m.inputTokenLimit } : {}),
    })) ?? []
  );
}
