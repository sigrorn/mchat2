// ------------------------------------------------------------------
// Component: Token-buffer decision helper (#131)
// Responsibility: Pure function that decides whether per-token onEvent
//                 calls should be suppressed during streaming. Covers
//                 the cols+multi forced-buffering rule (#16) plus the
//                 user-facing Stream/Buffer toggle (#131).
// Collaborators: hooks/useSend.ts.
// ------------------------------------------------------------------

export interface BufferDecisionInput {
  displayMode: "lines" | "cols";
  multiTarget: boolean;
  /** When false, user has opted into buffered-response display. */
  streamResponses: boolean;
}

export function shouldBufferTokens(input: BufferDecisionInput): boolean {
  // Cols mode with multiple targets forces buffering — live partial
  // content in a grid cell causes layout jitter (#16). This overrides
  // the user toggle.
  if (input.displayMode === "cols" && input.multiTarget) return true;
  // Otherwise, the user toggle decides.
  return !input.streamResponses;
}
