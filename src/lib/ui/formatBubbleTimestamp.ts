// ------------------------------------------------------------------
// Component: Bubble timestamp formatter (#243)
// Responsibility: Pure ms-epoch → "YYYY-MM-DD HH:MM:SS" in local time,
//                 24-hour, zero-padded. Rendered at the right edge of
//                 every chat bubble's header line so the user can
//                 orient in long conversations and correlate with
//                 provider incidents.
// Collaborators: components/MessageBubble.tsx.
// ------------------------------------------------------------------

const pad = (n: number): string => n.toString().padStart(2, "0");

export function formatBubbleTimestamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
