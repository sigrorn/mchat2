// ------------------------------------------------------------------
// Component: PersonaProviderLabel
// Responsibility: Render a persona's provider/preset label with its
//                 hosting tag (#141/#171). openai_compat personas show
//                 their preset display name + per-preset hosting country;
//                 everything else reads the provider registry.
// Collaborators: PersonaRow (parent), useOpenAICompatPresets,
//                providers/registry + derived.
// Extracted from PersonaPanel.tsx in #319.
// ------------------------------------------------------------------

import type { Persona } from "@/lib/types";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { formatHostingTag } from "@/lib/providers/derived";
import { useOpenAICompatPresets } from "../useOpenAICompatPresets";

export function PersonaProviderLabel({ persona }: { persona: Persona }): JSX.Element {
  const presets = useOpenAICompatPresets();
  if (persona.provider === "openai_compat" && persona.openaiCompatPreset) {
    const ref = persona.openaiCompatPreset;
    const match = presets.find(
      (p) =>
        p.ref.kind === ref.kind &&
        (p.ref.kind === "builtin"
          ? p.ref.id === (ref as { kind: "builtin"; id: string }).id
          : p.ref.name === (ref as { kind: "custom"; name: string }).name),
    );
    const tag = formatHostingTag(match?.hostingCountry ?? null);
    const label = match?.displayName ?? "openai-compat";
    return <>{tag ? `${tag} ${label}` : label}</>;
  }
  const tag = formatHostingTag(PROVIDER_REGISTRY[persona.provider].hostingCountry);
  return <>{tag ? `${tag} ${persona.provider}` : persona.provider}</>;
}
