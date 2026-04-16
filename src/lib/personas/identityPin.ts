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

// Companion to the identity instruction (#38). Reframes the persona as
// a chat-state fact ('Added persona X') rather than a hypothetical
// instruction — modern LLMs (Claude Sonnet 4.6, GPT-4o, Mistral, etc.)
// follow this anchored framing where they ignore the bare instruction
// alone. Old mchat used the same wording.
export function buildIdentitySetupNote(name: string, provider: string): string {
  return `Added persona "${name}" (${provider}, inherit)`;
}

// Detector for the legacy-single-pin case: a row matching the identity
// instruction wording (so we don't treat the setup note as the identity
// pin or vice versa).
function isIdentityInstruction(content: string): boolean {
  return /^Unless I say otherwise, for the scope of our chat/.test(content);
}

function isSetupNote(content: string): boolean {
  return /^Added persona "/.test(content);
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
  const expectedInstruction = buildIdentityPinContent(persona.name);
  const expectedSetup = buildIdentitySetupNote(persona.name, persona.provider);

  const ownPins = messages.filter(
    (m) => m.role === "user" && m.pinned && m.pinTarget === persona.id,
  );
  const existingInstruction = ownPins.find((m) => isIdentityInstruction(m.content));
  const existingSetup = ownPins.find((m) => isSetupNote(m.content));

  if (existingInstruction) {
    if (existingInstruction.content !== expectedInstruction) {
      await repo.updateMessageContent(existingInstruction.id, expectedInstruction, null, false);
    }
  } else {
    await appendPin(conversationId, persona.id, expectedInstruction, repo);
  }

  if (existingSetup) {
    if (existingSetup.content !== expectedSetup) {
      await repo.updateMessageContent(existingSetup.id, expectedSetup, null, false);
    }
  } else {
    await appendPin(conversationId, persona.id, expectedSetup, repo);
  }
}

async function appendPin(
  conversationId: string,
  personaId: string,
  content: string,
  repo: IdentityPinRepo,
): Promise<void> {
  await repo.appendMessage({
    conversationId,
    role: "user",
    content,
    provider: null,
    model: null,
    personaId: null,
    displayMode: "lines",
    pinned: true,
    pinTarget: personaId,
    addressedTo: [],
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
  });
}
