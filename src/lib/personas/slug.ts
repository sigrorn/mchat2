// ------------------------------------------------------------------
// Component: Name slug
// Responsibility: Canonicalize a persona display name to the form
//                 used for @-prefix matching and uniqueness.
// Collaborators: personas/service.ts, personas/resolver.ts.
// ------------------------------------------------------------------

// Lowercase, strip punctuation/whitespace. Unicode letters/digits kept.
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
