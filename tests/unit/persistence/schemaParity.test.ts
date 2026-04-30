// Schema parity (#189): the hand-authored schema.ts must agree with
// the migrations on column names per table. Catches the "added a
// migration column but forgot to update schema.ts" regression that
// would otherwise show up only when Kysely compile-checks a query
// that references the missing column.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import type { Database } from "@/lib/persistence/schema";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

// Hand-listed because Database is a TS-only interface — there's no
// runtime reflection that can give us the column list. Update this
// alongside Database when schema.ts changes.
const SCHEMA_COLUMNS: Record<keyof Database, readonly string[]> = {
  conversations: [
    "id",
    "title",
    "system_prompt",
    "created_at",
    "last_provider",
    "limit_mark_index",
    "display_mode",
    "visibility_mode",
    "visibility_matrix",
    "limit_size_tokens",
    "selected_personas",
    "compaction_floor_index",
    "autocompact_threshold",
    "context_warnings_fired",
    "flow_mode",
  ],
  personas: [
    "id",
    "conversation_id",
    "provider",
    "name",
    "name_slug",
    "system_prompt_override",
    "model_override",
    "color_override",
    "created_at_message_index",
    "sort_order",
    "runs_after",
    "deleted_at",
    "apertus_product_id",
    "visibility_defaults",
    "openai_compat_preset",
    "role_lens",
  ],
  messages: [
    "id",
    "conversation_id",
    "role",
    "content",
    "provider",
    "model",
    "persona_id",
    "display_mode",
    "pinned",
    "pin_target",
    "addressed_to",
    "created_at",
    "idx",
    "error_message",
    "error_transient",
    "input_tokens",
    "output_tokens",
    "usage_estimated",
    "audience",
    "ttft_ms",
    "stream_ms",
    "superseded_at",
    "confirmed_at",
  ],
  settings: ["key", "value"],
  runs: [
    "id",
    "conversation_id",
    "kind",
    "started_at",
    "completed_at",
    "flow_step_id",
  ],
  run_targets: [
    "id",
    "run_id",
    "target_key",
    "persona_id",
    "provider",
    "model",
    "status",
  ],
  attempts: [
    "id",
    "run_target_id",
    "sequence",
    "content",
    "started_at",
    "completed_at",
    "error_message",
    "error_transient",
    "input_tokens",
    "output_tokens",
    "ttft_ms",
    "stream_ms",
    "superseded_at",
  ],
  conversation_personas_selected: ["conversation_id", "persona_id"],
  persona_visibility: ["conversation_id", "observer_slug", "source_slug", "visible"],
  persona_runs_after: ["child_id", "parent_id"],
  conversation_context_warnings: ["conversation_id", "threshold", "fired_at"],
  flows: ["id", "conversation_id", "current_step_index", "loop_start_index"],
  flow_steps: ["id", "flow_id", "sequence", "kind", "instruction"],
  flow_step_personas: ["flow_step_id", "persona_id"],
};

describe("schema.ts agrees with migrations on column lists", () => {
  for (const [table, expected] of Object.entries(SCHEMA_COLUMNS) as [
    keyof Database,
    readonly string[],
  ][]) {
    it(`${table} columns match`, async () => {
      handle = await createTestDb();
      const cols = await sql.select<{ name: string }>(`PRAGMA table_info(${table})`);
      const actual = cols.map((c) => c.name).sort();
      const expectedSorted = [...expected].sort();
      expect(actual).toEqual(expectedSorted);
      handle.restore();
      handle = null;
    });
  }
});
