// ------------------------------------------------------------------
// Component: Trace filename helpers
// Responsibility: Pure helpers for the #46 debug-trace redesign:
//                 format a Date as YYYYMMDD-hhmmss (session stamp)
//                 and assemble the per-conversation-per-persona
//                 trace filename. Sanitization keeps a weird persona
//                 slug from escaping the working directory.
// Collaborators: stores/uiStore (session capture),
//                lib/tracing/traceFileSink (filename consumer).
// ------------------------------------------------------------------

export function buildSessionTimestamp(d: Date): string {
  const pad = (n: number, w = 2): string => n.toString().padStart(w, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|\s\0]+/g;

function safeSegment(s: string): string {
  return s.replace(UNSAFE_FILENAME_CHARS, "_");
}

export function buildTraceFilename(
  sessionTimestamp: string,
  conversationId: string,
  personaSlug: string,
): string {
  return `${sessionTimestamp}-${safeSegment(conversationId)}-${safeSegment(personaSlug)}.txt`;
}
