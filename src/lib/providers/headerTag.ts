// ------------------------------------------------------------------
// Component: Provider header tag
// Responsibility: Format the provider-segment of a message bubble's
//                 header. For native providers this is just the
//                 provider id; for openai_compat it discloses which
//                 preset (built-in or custom) the persona resolves
//                 to so an error in a multi-preset setup is
//                 immediately attributable.
// History:       Introduced in #203 — a 404 from Infomaniak's
//                openai_compat preset rendered as 'openai_compat',
//                indistinguishable from any other preset.
// Collaborators: components/MessageBubble (consumer).
// ------------------------------------------------------------------

import type { Persona, ProviderId } from "../types";
import { builtinPresetById } from "./openaiCompatPresets";

export function formatProviderTag(
  provider: ProviderId,
  persona: Persona | null,
): string {
  if (provider !== "openai_compat") return provider;
  const preset = persona?.openaiCompatPreset;
  if (!preset) return "openai_compat";
  if (preset.kind === "custom") return `openai_compat (${preset.name})`;
  const builtin = builtinPresetById(preset.id);
  return `openai_compat (${builtin?.displayName ?? preset.id})`;
}
