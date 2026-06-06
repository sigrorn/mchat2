// ------------------------------------------------------------------
// Component: Model benchmark hints (Artificial Analysis)
// Responsibility: Fetch + cache Artificial Analysis's per-model
//                 Intelligence Index (#299) and resolve it for a given
//                 model id so the picker can show a relative-performance
//                 hint. One call returns all models; cached persistently
//                 with a long TTL (stale-while-revalidate, ADR 013/014).
//                 Entirely silent without a user-supplied API key — no
//                 fetch, no scores, no error.
// Collaborators: tauri/http (request), tauri/keychain (the user's AA
//                key), persistence/settings (the cached slim blob).
// ------------------------------------------------------------------

import type { ProviderId } from "../types";
import { request } from "../tauri/http";
import { keychain } from "../tauri/keychain";
import { getSetting, setSetting } from "../persistence/settings";

export const AA_KEYCHAIN_SLOT = "artificial_analysis_api_key";
export const AA_SIGNUP_URL = "https://artificialanalysis.ai/";
const AA_CACHE_KEY = "artificial_analysis.cache";
const AA_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const AA_TTL_MS = 24 * 60 * 60_000;

// Slim per-model record we persist — only what the lookup needs, not
// AA's full payload.
interface BenchmarkModel {
  slug: string;
  creator?: string;
  intelligence: number;
  reasoning: boolean;
}

interface CachedBlob {
  at: number;
  models: BenchmarkModel[];
}

// In-memory index: normalized model key → intelligence index. Rebuilt
// whenever the cache is (re)loaded.
let index = new Map<string, number>();

// Subscribers re-read after a (re)load changes the scores so an open
// picker reflects them without being reopened.
const listeners = new Set<() => void>();
export function subscribeBenchmarks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notifyBenchmarks(): void {
  for (const fn of listeners) fn();
}

// Test seam — drop the in-memory index (the persisted blob lives in the
// settings table, which tests recreate per case; clearing memory alone
// simulates a restart).
export function __clearBenchmarks(): void {
  index = new Map();
}

// Curated aliases for ids that normalization can't bridge to an AA slug
// (left → right are both already normalized). Kept small; extend as real
// mismatches surface. Example shape:
//   "gemini-2-5-pro-preview": "gemini-2-5-pro",
const ALIASES: Record<string, string> = {};

// Normalize a model id (native or OpenRouter "vendor/model") to a stable
// comparison key: lowercase, drop the vendor prefix, dots→hyphens, strip
// a trailing date (-YYYYMMDD / -YYYY-MM-DD) and -latest, collapse any
// other non-alphanumerics to single hyphens.
export function normalizeModelKey(id: string): string {
  let s = id.toLowerCase().trim();
  const slash = s.lastIndexOf("/");
  if (slash !== -1) s = s.slice(slash + 1);
  s = s.replace(/\./g, "-");
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/-\d{4}-\d{2}-\d{2}$/, ""); // -YYYY-MM-DD
  s = s.replace(/-\d{8}$/, ""); // -YYYYMMDD
  s = s.replace(/-latest$/, "");
  return s.replace(/^-+|-+$/g, "");
}

function isReasoning(slug: string, name: string): boolean {
  return /think|reasoning/i.test(`${slug} ${name}`);
}

// Resolve the intelligence index for a model id. Tiers: exact normalized
// match → curated alias → guarded version-suffix prefix (one key is a
// prefix of the other and the extra part is only digits/hyphens, e.g.
// "claude-sonnet-4" ↔ "claude-sonnet-4-6"). Returns undefined when no
// confident match exists (picker then shows no AA segment).
export function lookupIntelligence(_provider: ProviderId, modelId: string): number | undefined {
  const key = normalizeModelKey(modelId);
  if (!key) return undefined;
  const exact = index.get(key);
  if (exact !== undefined) return exact;
  const alias = ALIASES[key];
  if (alias && index.has(alias)) return index.get(alias);
  return prefixMatch(key);
}

function prefixMatch(key: string): number | undefined {
  let best: number | undefined;
  for (const [k, v] of index) {
    const longer = k.length > key.length ? k : key;
    const shorter = k.length > key.length ? key : k;
    if (!longer.startsWith(`${shorter}-`)) continue;
    const extra = longer.slice(shorter.length + 1);
    if (!/^[0-9-]+$/.test(extra)) continue; // only a version suffix differs
    if (best === undefined || v > best) best = v;
  }
  return best;
}

function buildIndex(models: BenchmarkModel[]): Map<string, number> {
  const groups = new Map<string, BenchmarkModel[]>();
  for (const m of models) {
    if (typeof m.intelligence !== "number" || !Number.isFinite(m.intelligence)) continue;
    const key = normalizeModelKey(m.slug);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(m);
    else groups.set(key, [m]);
  }
  const idx = new Map<string, number>();
  for (const [key, entries] of groups) {
    // Prefer non-reasoning variants (mchat2 calls models in plain mode);
    // fall back to reasoning-only entries. Within the chosen pool take
    // the best score.
    const plain = entries.filter((e) => !e.reasoning);
    const pool = plain.length ? plain : entries;
    idx.set(key, Math.max(...pool.map((e) => e.intelligence)));
  }
  return idx;
}

interface AaEntry {
  slug?: string;
  id?: string;
  name?: string;
  model_creator?: { slug?: string };
  evaluations?: { artificial_analysis_intelligence_index?: number };
  // Tolerate a flat layout too, in case the shape differs.
  artificial_analysis_intelligence_index?: number;
}

function parseAa(body: string): BenchmarkModel[] {
  const parsed = JSON.parse(body) as { data?: AaEntry[] } | AaEntry[];
  const rows: AaEntry[] = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
  const out: BenchmarkModel[] = [];
  for (const e of rows) {
    const slug = e.slug ?? e.id;
    const intelligence =
      e.evaluations?.artificial_analysis_intelligence_index ??
      e.artificial_analysis_intelligence_index;
    if (!slug || typeof intelligence !== "number") continue;
    out.push({
      slug,
      ...(e.model_creator?.slug ? { creator: e.model_creator.slug } : {}),
      intelligence,
      reasoning: isReasoning(slug, e.name ?? ""),
    });
  }
  return out;
}

async function loadPersisted(): Promise<CachedBlob | null> {
  try {
    const raw = await getSetting(AA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBlob;
    return Array.isArray(parsed.models) ? parsed : null;
  } catch {
    return null;
  }
}

// Load benchmark scores: seed the index from the persisted blob for
// instant availability, then (if a key is set and the cache is stale or
// missing) fetch a fresh list, persist it, and rebuild the index. Silent
// and non-throwing throughout — callers fire-and-forget.
export async function loadBenchmarks(): Promise<void> {
  const persisted = await loadPersisted();
  if (persisted) {
    index = buildIndex(persisted.models);
    notifyBenchmarks();
  }

  const key = await keychain.get(AA_KEYCHAIN_SLOT);
  if (!key) return; // no key → entirely silent, no fetch

  const fresh = persisted && Date.now() - persisted.at < AA_TTL_MS;
  if (fresh) return;

  try {
    const res = await request({ url: AA_URL, method: "GET", headers: { "x-api-key": key } });
    if (res.status >= 400) return; // silent; keep whatever the cache gave us
    const models = parseAa(res.body);
    if (models.length === 0) return;
    await setSetting(AA_CACHE_KEY, JSON.stringify({ at: Date.now(), models } satisfies CachedBlob));
    index = buildIndex(models);
    notifyBenchmarks();
  } catch {
    // Network/parse failure: keep the persisted index; never surface.
  }
}

// Startup warm — alias for loadBenchmarks(), kept for symmetry with
// warmModelCaches() and to read as intent at the call site.
export async function warmBenchmarks(): Promise<void> {
  await loadBenchmarks();
}
