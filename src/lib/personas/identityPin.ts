// ------------------------------------------------------------------
// Component: Identity pin
// Responsibility: Auto-maintain the pinned user-role message that
//                 tells a persona to refer to itself by its name.
//                 Creates a new pin if missing; on rename, updates the
//                 existing row's content rather than adding a new one
//                 (the exact failure mode mchat#163 fixed).
// Collaborators: persistence/messages.ts (via injected repo),
//                personas/service.ts callers after create/rename.
// ------------------------------------------------------------------

import type { Message, Persona } from "../types";

export function buildIdentityPinContent(name: string): string {
  return (
    `Unless I say otherwise, for the scope of our chat, if my inputs refer to your name, ` +
    `use ${name} as your name. ` +
    `I might refer to it in order to use it as a placeholder, ` +
    `and I want you to refer to yourself as ${name}.`
  );
}

// Subset of messagesRepo that we actually need. Kept as a parameter so
// unit tests can inject a recorder and the hook-point in the service
// doesn't need to import the repo module directly.
export interface IdentityPinRepo {
  appendMessage(
    partial: Omit<Message, "id" | "index" | "createdAt"> & {
      id?: string;
      createdAt?: number;
    },
  ): Promise<Message>;
  updateMessageContent(
    id: string,
    content: string,
    errorMessage?: string | null,
    errorTransient?: boolean,
  ): Promise<void>;
}

export async function ensureIdentityPin(
  conversationId: string,
  persona: Persona,
  messages: readonly Message[],
  repo: IdentityPinRepo,
): Promise<void> {
  const expected = buildIdentityPinContent(persona.name);
  const existing = messages.find(
    (m) => m.role === "user" && m.pinned && m.pinTarget === persona.id,
  );
  if (existing) {
    if (existing.content !== expected) {
      await repo.updateMessageContent(existing.id, expected, null, false);
    }
    return;
  }
  await repo.appendMessage({
    conversationId,
    role: "user",
    content: expected,
    provider: null,
    model: null,
    personaId: null,
    displayMode: "lines",
    pinned: true,
    pinTarget: persona.id,
    addressedTo: [],
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
  });
}
