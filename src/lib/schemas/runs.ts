// ------------------------------------------------------------------
// Component: Runs schemas
// Responsibility: zod schemas at the persistence boundary for the
//                 runs / run_targets / attempts tables (#174 → #176).
//                 Validates row shape on read so a corrupt row (or a
//                 future kind/status the running version doesn't
//                 recognize) surfaces as a parse error instead of
//                 silently coercing.
// Collaborators: lib/persistence/runs (consumer).
// ------------------------------------------------------------------

import { z } from "zod";

export const runKindSchema = z.enum(["send", "retry", "replay", "compaction"]);

export const runTargetStatusSchema = z.enum([
  "queued",
  "streaming",
  "complete",
  "error",
  "cancelled",
  "superseded",
]);

export const replacementPolicyKindSchema = z.enum(["append", "supersede", "branch"]);

export const runRowSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  kind: runKindSchema,
  started_at: z.number(),
  completed_at: z.number().nullable(),
});

export const runTargetRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  target_key: z.string(),
  persona_id: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: runTargetStatusSchema,
});

export const attemptRowSchema = z.object({
  id: z.string(),
  run_target_id: z.string(),
  sequence: z.number(),
  content: z.string(),
  started_at: z.number(),
  completed_at: z.number().nullable(),
  error_message: z.string().nullable(),
  error_transient: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  ttft_ms: z.number().nullable(),
  stream_ms: z.number().nullable(),
  superseded_at: z.number().nullable(),
});

export type RunRow = z.infer<typeof runRowSchema>;
export type RunTargetRow = z.infer<typeof runTargetRowSchema>;
export type AttemptRow = z.infer<typeof attemptRowSchema>;
