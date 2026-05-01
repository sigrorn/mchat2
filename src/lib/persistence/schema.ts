// ------------------------------------------------------------------
// Component: Persistence schema (Kysely)
// Responsibility: Hand-authored TS schema mirroring the migrations
//                 in lib/persistence/migrations.ts (#188 → #189).
//                 The Kysely Database type is the "source of truth"
//                 for typed queries — every repo that adopts Kysely
//                 picks up its column types from here.
// Maintenance:    When a new migration adds a column, update this
//                 file in the same PR. tests/unit/persistence/
//                 schemaParity.test.ts catches forgotten updates.
// Collaborators: lib/persistence/db (Kysely instance), all repo
//                files migrated to Kysely.
// ------------------------------------------------------------------

import type { Generated } from "kysely";

/**
 * Column shapes for each table. SQLite stores everything as TEXT/
 * INTEGER/REAL/BLOB/NULL — this schema reflects the JS-side types
 * that the repo layer maps onto. Booleans stored as 0/1 INTEGER are
 * typed as `number` here so Kysely doesn't get confused by literal
 * 1/0 vs true/false.
 */
export interface ConversationsTable {
  id: string;
  title: string;
  system_prompt: string | null;
  created_at: number;
  last_provider: string | null;
  limit_mark_index: number | null;
  display_mode: string;
  visibility_mode: string;
  visibility_matrix: string; // JSON-encoded
  limit_size_tokens: number | null;
  selected_personas: string; // JSON-encoded
  compaction_floor_index: number | null;
  autocompact_threshold: string | null; // JSON-encoded
  context_warnings_fired: string; // JSON-encoded
  // #223: 0/1 — whether the persona selection is currently being
  // auto-managed by the conversation's flow. Off when no flow is
  // attached. Flips on after a flow-advancing send and off when the
  // user manually edits the selection.
  flow_mode: number;
}

export interface PersonasTable {
  id: string;
  conversation_id: string;
  provider: string;
  name: string;
  name_slug: string;
  system_prompt_override: string | null;
  model_override: string | null;
  color_override: string | null;
  created_at_message_index: number;
  sort_order: number;
  deleted_at: number | null;
  apertus_product_id: string | null;
  visibility_defaults: string; // JSON-encoded
  openai_compat_preset: string | null; // JSON-encoded or null
  // #213: per-persona role lens. JSON map
  // { speakerKey -> "user" | "assistant" }. speakerKey = persona-id
  // or literal "user". Empty '{}' default preserves today's mapping.
  role_lens: string;
}

export interface MessagesTable {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  provider: string | null;
  model: string | null;
  persona_id: string | null;
  display_mode: string;
  pinned: number; // 0/1
  pin_target: string | null;
  addressed_to: string; // JSON-encoded
  created_at: number;
  idx: number;
  error_message: string | null;
  error_transient: number; // 0/1
  input_tokens: number;
  output_tokens: number;
  usage_estimated: number; // 0/1
  audience: string; // JSON-encoded
  ttft_ms: number | null;
  stream_ms: number | null;
  // #206: stamped by replay/retry to hide a message from the UI
  // without deleting it. NULL means visible. Reads (UI filter,
  // context builder, listSupersededMessageIds) consult this directly.
  superseded_at: number | null;
  // #229: stamped when the user confirms a notice via its checkbox.
  // NULL means unconfirmed (default). The renderer hides confirmed
  // notices but the row stays so a future un-hide affordance (see
  // docs/ideas.md) can clear this back to NULL.
  confirmed_at: number | null;
  // #231: 0/1 flag — set on a user row when its dispatch went
  // through the flow path (planFlowDispatch.shouldDispatchAsFlow).
  // Lets the chat header render '→ conversation → @claudio @geppetto'
  // so a flow turn is distinguishable from an explicit multi-target
  // @a,@b send. Default 0 preserves today's rendering for every row.
  flow_dispatched: number; // 0/1
}

export interface SettingsTable {
  key: string;
  value: string;
}

export interface RunsTable {
  id: string;
  conversation_id: string;
  kind: string;
  started_at: number;
  completed_at: number | null;
  // #215: nullable flow step. Stamped when the run was triggered as
  // part of a conversation flow's `personas` step; null otherwise.
  flow_step_id: string | null;
}

// #215: per-conversation cyclic flow definition. One row per
// conversation (UNIQUE on conversation_id).
export interface FlowsTable {
  id: string;
  conversation_id: string;
  current_step_index: number;
  // #220: cycle wraps back to this index (instead of 0) at end of
  // flow. Default 0 preserves today's wrap-to-step-0 behaviour.
  loop_start_index: number;
}

// #215: ordered steps within a flow. UNIQUE(flow_id, sequence).
// kind ∈ {"user", "personas"} (CHECK in migration).
export interface FlowStepsTable {
  id: string;
  flow_id: string;
  sequence: number;
  kind: string;
  // #230: optional hidden instruction appended to the system prompt
  // of every persona dispatched at this step. NULL = none.
  instruction: string | null;
}

// #215: junction of personas participating in a `personas` step.
export interface FlowStepPersonasTable {
  flow_step_id: string;
  persona_id: string;
}

export interface RunTargetsTable {
  id: string;
  run_id: string;
  target_key: string;
  persona_id: string | null;
  provider: string | null;
  model: string | null;
  status: string;
}

export interface AttemptsTable {
  id: string;
  run_target_id: string;
  sequence: number;
  content: string;
  started_at: number;
  completed_at: number | null;
  error_message: string | null;
  error_transient: number;
  input_tokens: number;
  output_tokens: number;
  ttft_ms: number | null;
  stream_ms: number | null;
  superseded_at: number | null;
}

// #193: junction table replacing the JSON-encoded
// conversations.selected_personas column. The legacy column stays in
// place as a dual-write for rollback safety; reads happen here.
export interface ConversationPersonasSelectedTable {
  conversation_id: string;
  persona_id: string;
}

// #194: relational form of conversations.visibility_matrix +
// personas.visibility_defaults. The legacy JSON columns stay
// populated; the read-path switch is deferred to a follow-up issue.
export interface PersonaVisibilityTable {
  conversation_id: string;
  observer_slug: string;
  source_slug: string;
  visible: number; // 0/1
}

// #196: relational form of conversations.context_warnings_fired.
// Adds a fired_at timestamp the JSON form lacked. Reads now come
// from this table; the legacy JSON column stays populated as a
// dual-write safety net.
export interface ConversationContextWarningsTable {
  conversation_id: string;
  threshold: number;
  fired_at: number;
}

export interface Database {
  conversations: ConversationsTable;
  personas: PersonasTable;
  messages: MessagesTable;
  settings: SettingsTable;
  runs: RunsTable;
  run_targets: RunTargetsTable;
  attempts: AttemptsTable;
  conversation_personas_selected: ConversationPersonasSelectedTable;
  persona_visibility: PersonaVisibilityTable;
  conversation_context_warnings: ConversationContextWarningsTable;
  flows: FlowsTable;
  flow_steps: FlowStepsTable;
  flow_step_personas: FlowStepPersonasTable;
}

// Re-export for callers that need the Generated marker (auto-incremented
// rowids etc.). Currently unused — every PK is an explicit string id —
// but exporting it keeps the schema.ts surface complete.
export type { Generated };
