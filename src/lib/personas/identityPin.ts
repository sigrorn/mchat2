// ------------------------------------------------------------------
// Component: Identity pin
// Responsibility: Auto-maintain the pinned user-role message that
//                 tells a persona to refer to itself by its name,
//                 and emit an "Added persona" notice for the user.
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

export function buildIdentitySetupNote(
  name: string,
  provider: string,
  scope: "inherit" | { newAtMsg: number },
): string {
  const scopeLabel = scope === "inherit" ? "inherit" : `new @ msg ${scope.newAtMsg}`;
  return `Added persona "${name}" (${provider}, ${scopeLabel})`;
}

function isIdentityInstruction(content: string): boolean {
  return /^Unless I say otherwise, for the scope of our chat/.test(content);
}

function isSetupNote(content: string): boolean {
  return /^Added persona "/.test(content);
}

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
  scope: "inherit" | { newAtMsg: number } = "inherit",
): Promise<void> {
  const expectedInstruction = buildIdentityPinContent(persona.name);

  // Identity instruction pin — sent to the LLM as a pinned user message.
  const ownPins = messages.filter(
    (m) => m.role === "user" && m.pinned && m.pinTarget === persona.id,
  );
  const existingInstruction = ownPins.find((m) => isIdentityInstruction(m.content));

  if (existingInstruction) {
    if (existingInstruction.content !== expectedInstruction) {
      await repo.updateMessageContent(existingInstruction.id, expectedInstruction, null, false);
    }
  } else {
    await appendPin(conversationId, persona.id, expectedInstruction, repo);
  }

  // #88: "Added persona" is a notice (user-facing only, not sent to LLMs).
  const expectedSetup = buildIdentitySetupNote(persona.name, persona.provider, scope);
  const existingSetup = messages.find(
    (m) => m.role === "notice" && isSetupNote(m.content) && m.content.includes(`"${persona.name}"`),
  );
  // Also check for legacy pinned setup notes.
  const legacySetup = ownPins.find((m) => isSetupNote(m.content));

  if (!existingSetup && !legacySetup) {
    await repo.appendMessage({
      conversationId,
      role: "notice",
      content: expectedSetup,
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines",
      pinned: false,
      pinTarget: null,
      addressedTo: [],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
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
