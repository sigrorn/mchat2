// ------------------------------------------------------------------
// Component: Message JSON-column schemas
// Responsibility: zod-backed parsers for the TEXT columns on the
//                 messages table that hold JSON arrays of persona keys
//                 (#165). Replaces the inline parseStringArray that
//                 lived in persistence/messages.ts. Both parsers
//                 soft-fail to [] so a single corrupt message row
//                 never breaks listMessages.
// Collaborators: persistence/messages.ts (consumer).
// ------------------------------------------------------------------

import { z } from "zod";

const personaKeyArraySchema = z.array(z.unknown()).transform((arr) =>
  arr.filter((x): x is string => typeof x === "string"),
);

function parsePersonaKeyArray(raw: string): string[] {
  if (raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const result = personaKeyArraySchema.safeParse(parsed);
  return result.success ? result.data : [];
}

export function parseAddressedTo(raw: string): string[] {
  return parsePersonaKeyArray(raw);
}

export function parseAudience(raw: string): string[] {
  return parsePersonaKeyArray(raw);
}
