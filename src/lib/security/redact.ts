// ------------------------------------------------------------------
// Component: Redaction
// Responsibility: Strip API keys and other obvious secrets from text
//                 before export or logging. Operates on both known-key
//                 exact matches (the user's current keys) and generic
//                 patterns (sk-, Bearer, AKIA, etc.).
// Collaborators: exports (HTML/JSON), dev log sinks.
// ------------------------------------------------------------------

export interface RedactInput {
  text: string;
  // Exact secret values to blot out (e.g. current keychain contents
  // for every provider). Passed in at call time — never imported.
  knownSecrets?: string[];
}

// Provider-ish API key shapes. Deliberately broad rather than narrow;
// a false positive on a random string is far less painful than leaking
// a live key in an export.
const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_\-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g,
  /\bAIza[0-9A-Za-z_\-]{30,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bpplx-[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9_.\-]{20,}\b/g,
];

export function redact(input: RedactInput): string {
  let out = input.text;
  if (input.knownSecrets) {
    for (const s of input.knownSecrets) {
      if (s && s.length >= 8) {
        out = out.split(s).join("[REDACTED]");
      }
    }
  }
  for (const re of PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}
