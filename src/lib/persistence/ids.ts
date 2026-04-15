// ------------------------------------------------------------------
// Component: Id generators
// Responsibility: Stable prefixed ids. Prefixes make logs and DB dumps
//                 readable without a lookup table.
// Collaborators: every repository.
// ------------------------------------------------------------------

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomId(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  }
  return out;
}

export const newConversationId = (): string => `c_${randomId(10)}`;
export const newPersonaId = (): string => `p_${randomId(8)}`;
export const newMessageId = (): string => `m_${randomId(12)}`;
