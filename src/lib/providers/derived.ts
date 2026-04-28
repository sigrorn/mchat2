// ------------------------------------------------------------------
// Component: Derived provider maps
// Responsibility: Compute lookup maps and reserved-name sets from
//                 PROVIDER_REGISTRY. These are the only way other
//                 modules should look up by prefix, color, etc. — so
//                 there is no second copy of the metadata to drift.
// Collaborators: personas/resolver.ts, personas/service.ts, UI.
// ------------------------------------------------------------------

import type { ProviderId } from "../types";
import { PROVIDER_REGISTRY, ALL_PROVIDER_IDS } from "./registry";

// Map every accepted @-token (primary prefix + any aliases from #41)
// to its provider id.
export const PREFIX_TO_PROVIDER: ReadonlyMap<string, ProviderId> = (() => {
  const m = new Map<string, ProviderId>();
  for (const id of ALL_PROVIDER_IDS) {
    const meta = PROVIDER_REGISTRY[id];
    m.set(meta.prefix, id);
    for (const a of meta.aliases ?? []) m.set(a, id);
  }
  return m;
})();

export const PROVIDER_COLORS: Readonly<Record<ProviderId, string>> = Object.freeze(
  Object.fromEntries(ALL_PROVIDER_IDS.map((id) => [id, PROVIDER_REGISTRY[id].color])) as Record<
    ProviderId,
    string
  >,
);

export const PROVIDER_DISPLAY_NAMES: Readonly<Record<ProviderId, string>> = Object.freeze(
  Object.fromEntries(
    ALL_PROVIDER_IDS.map((id) => [id, PROVIDER_REGISTRY[id].displayName]),
  ) as Record<ProviderId, string>,
);

// Reserved names cannot be used as persona names: provider prefixes,
// "all", "others". Matched case-insensitively against the slug form.
export const RESERVED_PERSONA_NAMES: ReadonlySet<string> = (() => {
  // #216: 'convo' joins 'all' and 'others' as a flow-aware @-token.
  // Reserving prevents a persona literally named "convo" from
  // shadowing the keyword.
  const set = new Set<string>(["all", "others", "convo"]);
  for (const id of ALL_PROVIDER_IDS) {
    const meta = PROVIDER_REGISTRY[id];
    set.add(meta.prefix);
    for (const a of meta.aliases ?? []) set.add(a);
  }
  return set;
})();

export function isReservedName(slug: string): boolean {
  return RESERVED_PERSONA_NAMES.has(slug);
}

export function providerForPrefix(prefix: string): ProviderId | null {
  return PREFIX_TO_PROVIDER.get(prefix.toLowerCase()) ?? null;
}

// #141 phase 1 — wrap an ISO 3166 alpha-2 country code in brackets,
// e.g. `[CH]`. Bracketed codes instead of flag emojis because Tauri
// on Windows can't render `🇨🇭` (Windows ships no flag glyphs;
// Twemoji would add ~50–200KB for what is fundamentally an
// information-density gain). Empty string when no code is set.
export function formatHostingTag(country: string | null): string {
  if (!country) return "";
  return `[${country.toUpperCase()}]`;
}
