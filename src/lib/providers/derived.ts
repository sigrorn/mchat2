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

export const PREFIX_TO_PROVIDER: ReadonlyMap<string, ProviderId> = new Map(
  ALL_PROVIDER_IDS.map((id) => [PROVIDER_REGISTRY[id].prefix, id]),
);

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
export const RESERVED_PERSONA_NAMES: ReadonlySet<string> = new Set<string>([
  ...ALL_PROVIDER_IDS.map((id) => PROVIDER_REGISTRY[id].prefix),
  "all",
  "others",
]);

export function isReservedName(slug: string): boolean {
  return RESERVED_PERSONA_NAMES.has(slug);
}

export function providerForPrefix(prefix: string): ProviderId | null {
  return PREFIX_TO_PROVIDER.get(prefix.toLowerCase()) ?? null;
}
