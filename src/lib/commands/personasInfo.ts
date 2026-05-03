// ------------------------------------------------------------------
// Component: Personas info formatter
// Responsibility: Format the //personas notice showing each persona's
//                 name, provider, model, token limit, and costs.
// Collaborators: components/Composer.tsx.
// ------------------------------------------------------------------

import type { Message, Persona } from "../types";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { maxContextTokensForPersona } from "../providers/contextWindows";
import { computePersonaCosts, formatPersonaCost } from "../pricing/personaCosts";

export function formatPersonasInfo(personas: readonly Persona[], messages: readonly Message[]): string {
  if (personas.length === 0) return "personas: none.";
  const costs = computePersonaCosts(messages, personas);
  const lines = personas.map((p) => {
    const model = p.modelOverride ?? PROVIDER_REGISTRY[p.provider].defaultModel;
    const maxTokens = maxContextTokensForPersona(p);
    const limit = Number.isFinite(maxTokens) ? `${Math.round(maxTokens / 1000)}k` : "unlimited";
    const cost = formatPersonaCost(costs[p.id]);
    return `  ${p.name}, ${p.provider}, ${model}, ${limit}, ${cost}`;
  });
  return `${personas.length} persona(s):\n${lines.join("\n")}`;
}
