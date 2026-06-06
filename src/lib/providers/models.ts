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
import { getSetting, setSetting } from "../persistence/settings";
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
// persona's openai_compat preset. Threaded straight into
// fetchProviderModelInfos. (Pre-#257 this also carried an
// apertusProductId; the native apertus adapter is gone.)
export interface ListModelInfosExtra {
  openaiCompatPreset?: Persona["openaiCompatPreset"];
}

const infoCache = new Map<string, { at: number; infos: ModelInfo[] }>();
const TTL_MS = 10 * 60_000;
// #297: persisted model lists survive restarts. Keyed in the flat
// settings keyspace by the same cacheKey as the in-memory cache. See
// ADR 013.
const PERSIST_PREFIX = "model_cache.";

// #297: subscribers are notified after a background revalidate replaces
// a cached list, so an open model picker re-reads instead of showing the
// stale list until the dialog is reopened.
type ModelCacheListener = () => void;
const cacheListeners = new Set<ModelCacheListener>();
export function subscribeModelCache(fn: ModelCacheListener): () => void {
  cacheListeners.add(fn);
  return () => cacheListeners.delete(fn);
}
function notifyModelCache(): void {
  for (const fn of cacheListeners) fn();
}

// Test seam — clear the IN-MEMORY model cache between cases. The
// persisted cache lives in the settings table, which tests recreate
// per-case via createTestDb; clearing memory alone simulates a restart.
export function __clearModelCache(): void {
  infoCache.clear();
}

function pricingFallback(provider: ProviderId): ModelInfo[] {
  // #255: openai_compat's PRICING entries (Apertus ids carried over from
  // the legacy native adapter) are for cost-snapshot accuracy, NOT a
  // default model list — so its fallback is intentionally empty.
  return provider === "openai_compat"
    ? []
    : Object.keys(PRICING[provider] ?? {}).map((id) => ({ id }));
}

async function loadPersistedModels(cacheKey: string): Promise<ModelInfo[] | null> {
  try {
    const raw = await getSetting(PERSIST_PREFIX + cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; infos?: ModelInfo[] };
    return Array.isArray(parsed.infos) ? parsed.infos : null;
  } catch {
    return null;
  }
}

async function persistModels(cacheKey: string, infos: ModelInfo[]): Promise<void> {
  try {
    await setSetting(PERSIST_PREFIX + cacheKey, JSON.stringify({ at: Date.now(), infos }));
  } catch {
    // Best-effort: a persistence write failure must not break listing.
  }
}

function cacheKeyFor(provider: ProviderId, extra: ListModelInfosExtra | undefined): string {
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

// Live fetch + filter + sort. On a non-empty result, updates BOTH the
// in-memory and persisted caches and notifies subscribers. Returns the
// pricing fallback (without caching) when the upstream list is empty.
// Throws on transport/HTTP error so callers can fall back to cache.
async function refreshModelInfos(
  provider: ProviderId,
  apiKey: string | null,
  extra: ListModelInfosExtra | undefined,
  cacheKey: string,
): Promise<ModelInfo[]> {
  const raw = await fetchProviderModelInfos(provider, apiKey, extra);
  const filtered = raw.filter((m) => isChatModel(provider, m.id));
  if (filtered.length === 0) return pricingFallback(provider);
  const sorted = dedup(filtered).sort((a, b) => a.id.localeCompare(b.id));
  infoCache.set(cacheKey, { at: Date.now(), infos: sorted });
  await persistModels(cacheKey, sorted);
  notifyModelCache();
  return sorted;
}

export async function listModelInfos(
  provider: ProviderId,
  apiKey: string | null,
  extra?: ListModelInfosExtra,
): Promise<ModelInfo[]> {
  const cacheKey = cacheKeyFor(provider, extra);
  const cached = infoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.infos;

  // #203: openai_compat resolves its api key through the preset, not the
  // top-level keychain, so a missing top-level apiKey is fine for it.
  // Other providers need a key to query their /models endpoints.
  const canFetch = apiKey !== null || provider === "openai_compat";

  // #297: stale-while-revalidate. Serve the last persisted list instantly;
  // when we can still fetch, kick off a background refresh that updates the
  // caches and notifies subscribers. See ADR 013.
  const persisted = await loadPersistedModels(cacheKey);
  if (persisted) {
    if (canFetch) {
      void refreshModelInfos(provider, apiKey, extra, cacheKey).catch(() => {});
    }
    return persisted;
  }

  if (!canFetch) return pricingFallback(provider);

  // Nothing cached anywhere → blocking fetch; fall back on failure.
  try {
    return await refreshModelInfos(provider, apiKey, extra, cacheKey);
  } catch {
    return pricingFallback(provider);
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
