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

interface OpenAICompatModelsResponse {
  data?: { id: string }[];
}
interface AnthropicModelsResponse {
  data?: { id: string }[];
}
interface GeminiModelsResponse {
  models?: { name: string }[];
}

const cache = new Map<string, { at: number; ids: string[] }>();
const TTL_MS = 10 * 60_000;

export async function listModels(
  provider: ProviderId,
  apiKey: string | null,
): Promise<string[]> {
  const cached = cache.get(provider);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ids;

  const fallback = Object.keys(PRICING[provider] ?? {});
  if (!apiKey) return fallback;

  try {
    const ids = await fetchProviderModels(provider, apiKey);
    if (ids.length === 0) return fallback;
    const sorted = [...new Set(ids)].sort();
    cache.set(provider, { at: Date.now(), ids: sorted });
    return sorted;
  } catch {
    return fallback;
  }
}

async function fetchProviderModels(provider: ProviderId, apiKey: string): Promise<string[]> {
  switch (provider) {
    case "openai":
      return openAICompatList("https://api.openai.com/v1/models", apiKey);
    case "perplexity":
      // Perplexity has no public /models endpoint; fall through to
      // fallback via empty return.
      return [];
    case "mistral":
      return openAICompatList("https://api.mistral.ai/v1/models", apiKey);
    case "apertus":
      return openAICompatList("https://api.apertus.swiss/v1/models", apiKey);
    case "claude":
      return anthropicList(apiKey);
    case "gemini":
      return geminiList(apiKey);
    case "mock":
      return [];
  }
}

async function openAICompatList(url: string, apiKey: string): Promise<string[]> {
  const res = await request({
    url,
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (res.status >= 400) throw new HttpError(res.status, res.body);
  const parsed = JSON.parse(res.body) as OpenAICompatModelsResponse;
  return parsed.data?.map((d) => d.id) ?? [];
}

async function anthropicList(apiKey: string): Promise<string[]> {
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
  return parsed.data?.map((d) => d.id) ?? [];
}

async function geminiList(apiKey: string): Promise<string[]> {
  const res = await request({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    method: "GET",
  });
  if (res.status >= 400) throw new HttpError(res.status, res.body);
  const parsed = JSON.parse(res.body) as GeminiModelsResponse;
  // Strip the 'models/' prefix that Gemini returns.
  return (
    parsed.models?.map((m) => m.name.replace(/^models\//, "")).filter((n) => !n.includes("embedding")) ??
    []
  );
}
