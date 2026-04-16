// ------------------------------------------------------------------
// Component: Retry target reconstruction
// Responsibility: Given a failed assistant message and the current
//                 persona list, compute the PersonaTarget needed to
//                 fire a fresh runStream (#43). Pure so tests don't
//                 need to stub useSend.
// Collaborators: hooks/useSend (manual retry invoker),
//                components/MessageList (retry button).
// ------------------------------------------------------------------

import type { Message, Persona, PersonaTarget } from "../types";
import { PROVIDER_REGISTRY } from "../providers/registry";

export function buildRetryTarget(
  message: Message,
  personas: readonly Persona[],
): PersonaTarget | null {
  if (message.role !== "assistant") return null;
  if (!message.provider) return null;
  if (message.personaId) {
    const persona = personas.find((p) => p.id === message.personaId);
    if (persona && persona.deletedAt === null) {
      return {
        provider: persona.provider,
        personaId: persona.id,
        key: persona.id,
        displayName: persona.name,
      };
    }
    // Persona gone — fall through to a bare-provider retry so the
    // user can still kick the request again even if the named persona
    // has been tombstoned since the failed row was written.
  }
  return {
    provider: message.provider,
    personaId: null,
    key: message.provider,
    displayName: PROVIDER_REGISTRY[message.provider].displayName,
  };
}
