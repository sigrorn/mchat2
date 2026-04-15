// ------------------------------------------------------------------
// Component: JSON export
// Responsibility: Dump a conversation and its messages to a portable
//                 JSON blob, redacted. Format is versioned so a future
//                 import path can detect and upgrade older exports.
// Collaborators: security/redact.ts.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "../types";
import { redact } from "../security/redact";

export interface JsonExportInput {
  conversation: Conversation;
  messages: Message[];
  personas: Persona[];
  knownSecrets: string[];
  generatedAt: string;
}

export interface JsonExportV1 {
  format: "mchat2";
  version: 1;
  generatedAt: string;
  conversation: Conversation;
  personas: Persona[];
  messages: Message[];
}

export function exportToJson(input: JsonExportInput): string {
  const redactedMessages: Message[] = input.messages.map((m) => ({
    ...m,
    content: redact({ text: m.content, knownSecrets: input.knownSecrets }),
  }));
  const payload: JsonExportV1 = {
    format: "mchat2",
    version: 1,
    generatedAt: input.generatedAt,
    conversation: input.conversation,
    personas: input.personas,
    messages: redactedMessages,
  };
  return JSON.stringify(payload, null, 2);
}
