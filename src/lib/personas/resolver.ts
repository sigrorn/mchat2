// ------------------------------------------------------------------
// Component: Persona resolver
// Responsibility: Parse @-prefixes at the start of a user message and
//                 resolve them to a send mode + list of PersonaTargets.
//                 Returns the message text with prefixes stripped, so
//                 the adapter sees clean content.
// Collaborators: orchestration/sendPlanner.ts.
// ------------------------------------------------------------------

import type { Persona, PersonaTarget, ResolveMode, ProviderId } from "../types";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { providerForPrefix } from "../providers/derived";
import { slugify } from "./slug";

export interface ResolveInput {
  text: string;
  personas: Persona[];
  // Current UI selection expressed as persona keys (personaId ?? provider).
  // Drives 'implicit' and 'others' modes.
  selection: string[];
}

export interface ResolveResult {
  mode: ResolveMode;
  targets: PersonaTarget[];
  // Message text with the @-prefix run stripped from the start.
  strippedText: string;
  // Names the user typed that matched no active persona and no provider
  // prefix. Reported to the user; the resolver does not silently drop.
  unknown: string[];
}

const PREFIX_RUN_RE = /^(\s*@[\p{L}\p{N}_-]+\s*)+/u;
const SINGLE_PREFIX_RE = /@([\p{L}\p{N}_-]+)/gu;

export function resolveTargets(input: ResolveInput): ResolveResult {
  const { text, personas, selection } = input;
  const runMatch = PREFIX_RUN_RE.exec(text);

  if (!runMatch) {
    return {
      mode: "implicit",
      targets: selectionToTargets(selection, personas),
      strippedText: text,
      unknown: [],
    };
  }

  const prefixRun = runMatch[0];
  const strippedText = text.slice(prefixRun.length);
  const names = [...prefixRun.matchAll(SINGLE_PREFIX_RE)]
    .map((m) => m[1])
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.toLowerCase());

  if (names.includes("all")) {
    return {
      mode: "all",
      targets: personas.map(personaToTarget),
      strippedText,
      unknown: [],
    };
  }

  if (names.includes("others")) {
    const selectionSet = new Set(selection);
    const targets = personas
      .filter((p) => !selectionSet.has(p.id))
      .map(personaToTarget);
    return { mode: "others", targets, strippedText, unknown: [] };
  }

  const targets: PersonaTarget[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const p = personas.find((x) => x.nameSlug === slugify(name));
    if (p) {
      targets.push(personaToTarget(p));
      continue;
    }
    const prov = providerForPrefix(name);
    if (prov) {
      targets.push(bareProviderTarget(prov));
      continue;
    }
    unknown.push(name);
  }
  return { mode: "targeted", targets, strippedText, unknown };
}

function personaToTarget(p: Persona): PersonaTarget {
  return {
    provider: p.provider,
    personaId: p.id,
    key: p.id,
    displayName: p.name,
  };
}

function bareProviderTarget(provider: ProviderId): PersonaTarget {
  return {
    provider,
    personaId: null,
    key: provider,
    displayName: PROVIDER_REGISTRY[provider].displayName,
  };
}

function selectionToTargets(selection: string[], personas: Persona[]): PersonaTarget[] {
  const out: PersonaTarget[] = [];
  for (const key of selection) {
    const p = personas.find((x) => x.id === key);
    if (p) out.push(personaToTarget(p));
    else {
      const prov = providerForPrefix(key);
      if (prov) out.push(bareProviderTarget(prov));
    }
  }
  return out;
}
