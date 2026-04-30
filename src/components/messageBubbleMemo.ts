// ------------------------------------------------------------------
// Component: MessageBubble memoization helper (#128, partial)
// Responsibility: Prop-equality comparator so MessageBubble can skip
//                 re-render when only the streamed row actually
//                 changed. A full virtualizer is deferred (see
//                 issue #128) until a real conversation stutters;
//                 memoization alone captures most of the streaming
//                 reconciliation cost for a fraction of the risk.
// Collaborators: components/MessageList.tsx.
// ------------------------------------------------------------------

import type { Message, Persona } from "@/lib/types";

export interface BubbleProps {
  message: Message;
  personas: readonly Persona[];
  userNumber: number | null;
  excluded: boolean;
  onRetry?: () => void;
  onEdit?: () => void;
  // #229: notice rows render a small confirm checkbox; clicking it
  // calls this. Undefined for non-notice rows (and for the renderer
  // that doesn't want to expose the affordance).
  onConfirm?: () => void;
}

function addressedEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * True iff the rendered output would be identical. Intentionally
 * ignores callback identity — closures produce new refs on every
 * parent render but don't affect what's drawn; the latest closure
 * still fires on click because the parent re-runs its JSX build
 * whenever a real change lands.
 */
export function areBubblePropsEqual(prev: BubbleProps, next: BubbleProps): boolean {
  if (prev === next) return true;
  if (prev.excluded !== next.excluded) return false;
  if (prev.userNumber !== next.userNumber) return false;
  if (prev.personas !== next.personas) return false;
  // onEdit presence is a meaningful role indicator (user rows get
  // an edit affordance, assistant rows don't). Identity doesn't
  // matter, but undefined vs defined does.
  if (!!prev.onEdit !== !!next.onEdit) return false;
  if (!!prev.onConfirm !== !!next.onConfirm) return false;
  const a = prev.message;
  const b = next.message;
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.content !== b.content) return false;
  if (a.errorMessage !== b.errorMessage) return false;
  if (a.pinned !== b.pinned) return false;
  if (a.pinTarget !== b.pinTarget) return false;
  if (a.personaId !== b.personaId) return false;
  if (a.provider !== b.provider) return false;
  if (a.model !== b.model) return false;
  if (a.role !== b.role) return false;
  if (!addressedEqual(a.addressedTo, b.addressedTo)) return false;
  return true;
}
