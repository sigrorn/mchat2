// ------------------------------------------------------------------
// Component: Model lister
// Responsibility: Return the list of known model ids for a provider.
//                 Prefers a live /models query with the user's API key
//                 so the picker always reflects what the account can
//                 actually invoke. Falls back to the static pricing
//                 table when the live call fails or there's no key.
// Collaborators: tauri/http.request, providers/registry.
// ------------------------------------------------------------------

import type { ProviderId } from "../types";
import { PRICING } from "../pricing/table";
import { request, HttpError } from "../tauri/http";

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

const infoCache = new Map<string, { at: number; infos: ModelInfo[] }>();
const TTL_MS = 10 * 60_000;

export async function listModels(
  provider: ProviderId,
  apiKey: string | null,
  extra?: { apertusProductId?: string | null },
): Promise<string[]> {
  const infos = await listModelInfos(provider, apiKey, extra);
  return infos.map((m) => m.id);
}

export async function listModelInfos(
  provider: ProviderId,
  apiKey: string | null,
  extra?: { apertusProductId?: string | null },
): Promise<ModelInfo[]> {
  const cacheKey = provider === "apertus" ? `apertus:${extra?.apertusProductId ?? ""}` : provider;
  const cached = infoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.infos;

  const fallback: ModelInfo[] = Object.keys(PRICING[provider] ?? {}).map((id) => ({ id }));
  if (!apiKey) return fallback;

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
  apiKey: string,
  extra?: { apertusProductId?: string | null },
): Promise<ModelInfo[]> {
  switch (provider) {
    case "openai":
      return openAICompatList("https://api.openai.com/v1/models", apiKey);
    case "perplexity":
      return [];
    case "mistral":
      return mistralList(apiKey);
    case "apertus": {
      const pid = extra?.apertusProductId?.trim();
      if (!pid) return [];
      return openAICompatList(
        `https://api.infomaniak.com/2/ai/${encodeURIComponent(pid)}/openai/v1/models`,
        apiKey,
      );
    }
    case "claude":
      return anthropicList(apiKey);
    case "gemini":
      return geminiList(apiKey);
    case "openai_compat":
      // Listing requires the resolved base URL, which only the
      // resolver knows. Phase A keeps the model field as a free
      // string; phase C may hook this up by accepting an extra hint
      // through the `extra` arg.
      return [];
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
