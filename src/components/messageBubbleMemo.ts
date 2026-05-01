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

// #239: per-bubble find state. When non-null, the bubble overlays
// inline <mark> highlights for every occurrence of `query`; the
// active-match-index'th occurrence (in document order within the
// bubble) gets the strong-active class so the user can see which
// one prev/next is on without reading the X-of-Y counter.
export interface FindState {
  query: string;
  caseSensitive: boolean;
  /** Active match index within THIS bubble (0-based), or -1 when
   *  the active match lives in another bubble. */
  activeMatchIndex: number;
}

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
  // #239: find-bar overlay state. Null when the bar is closed or
  // the query is empty.
  findState?: FindState | null;
}

function findStateEqual(a: FindState | null, b: FindState | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.query === b.query &&
    a.caseSensitive === b.caseSensitive &&
    a.activeMatchIndex === b.activeMatchIndex
  );
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
  // #239: find state affects the rendered overlay (highlights).
  if (!findStateEqual(prev.findState ?? null, next.findState ?? null)) return false;
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
  // #231: included so a row whose flow_dispatched flips between
  // versions of the same id re-renders with the new header. In
  // practice this is set once at append-time and never changes,
  // but we compare for correctness.
  if ((a.flowDispatched ?? false) !== (b.flowDispatched ?? false)) return false;
  return true;
}
