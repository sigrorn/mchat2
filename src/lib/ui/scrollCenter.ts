// ------------------------------------------------------------------
// Component: Match-centered scroll offset (#239)
// Responsibility: Pure helper that computes the container's desired
//                 scrollTop to vertically center a match. Clamps at
//                 the scroll bounds so a match in the first / last
//                 bubble doesn't try to over-scroll past start / end.
// Collaborators: components/MessageList (find-scroll effect),
//                components/FindBar (PgUp/PgDn forwarding).
// Pure — no DOM, no React.
// ------------------------------------------------------------------

export interface ComputeMatchScrollOffsetArgs {
  /** Top of the matched element relative to the chat container's
   *  scroll origin (i.e. element.offsetTop relative to the scroll root). */
  matchTop: number;
  matchHeight: number;
  containerHeight: number;
  scrollHeight: number;
}

export function computeMatchScrollOffset(args: ComputeMatchScrollOffsetArgs): number {
  const desired =
    args.matchTop + args.matchHeight / 2 - args.containerHeight / 2;
  const max = Math.max(0, args.scrollHeight - args.containerHeight);
  if (desired < 0) return 0;
  if (desired > max) return max;
  return desired;
}
