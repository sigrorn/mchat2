// Migration v29 — messages.cost_usd (#252).
//
// Snapshots the USD cost of each assistant message at stream completion
// so historical totals don't drift when the PRICING table changes.
// The column is REAL nullable: NULL means "pricing was unknown for this
// row's (provider, model)" — surfaces as "?" in the spend-table cell.
//
// Backfill rule: every existing assistant row whose (provider, model)
// matches a current PRICING entry gets a computed cost; rows whose
// model isn't in the table (and every openai_compat row, since that
// table is empty today) stay NULL. Non-assistant rows always stay NULL.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";
import { PRICING } from "@/lib/pricing/table";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConv(id: string): Promise<void> {
  await sql.execute(
    `INSERT INTO conversations
      (id, title, created_at, display_mode, visibility_mode,
       visibility_matrix, selected_personas, context_warnings_fired,
       flow_mode, last_seen_at, last_message_at)
      VALUES ('${id}', 't', 1, 'lines', 'separated', '{}', '[]', '[]', 0, 0, 0)`,
  );
}

async function seedMessage(args: {
  id: string;
  role: string;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  idx: number;
}): Promise<void> {
  const provider = args.provider === null ? "NULL" : `'${args.provider}'`;
  const model = args.model === null ? "NULL" : `'${args.model}'`;
  await sql.execute(
    `INSERT INTO messages
      (id, conversation_id, role, content, provider, model,
       created_at, idx, display_mode, pinned, addressed_to, audience,
       error_transient, input_tokens, output_tokens, usage_estimated,
       flow_dispatched)
      VALUES ('${args.id}', 'c1', '${args.role}', '', ${provider}, ${model},
              1, ${args.idx}, 'lines', 0, '[]', '[]', 0,
              ${args.inputTokens}, ${args.outputTokens}, 0, 0)`,
  );
}

describe("migration v29 — messages.cost_usd (#252)", () => {
  it("is at least the 29th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(29);
  });

  it("adds a nullable cost_usd REAL column", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>("PRAGMA table_info(messages)");
    const col = cols.find((c) => c.name === "cost_usd");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toContain("REAL");
    // Nullable: a NULL cost_usd means pricing was unknown — distinct
    // from $0 (zero tokens or genuinely free model).
    expect(col?.notnull).toBe(0);
  });

  it("backfills existing assistant rows whose (provider, model) is in PRICING", async () => {
    handle = await createTestDb({ stopAt: 28 });
    await seedConv("c1");
    // Pick a representative entry from PRICING that's certain to exist
    // for this assertion to be meaningful even if specific rates change.
    const claudePrices = PRICING.claude["claude-opus-4-6"];
    expect(claudePrices, "PRICING.claude[claude-opus-4-6] is the test fixture; keep it in the table").toBeDefined();
    await seedMessage({
      id: "m_known",
      role: "assistant",
      provider: "claude",
      model: "claude-opus-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      idx: 0,
    });
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ cost_usd: number | null }>(
      "SELECT cost_usd FROM messages WHERE id = 'm_known'",
    );
    const expected =
      (1000 / 1_000_000) * claudePrices!.inputUsdPerMTok +
      (500 / 1_000_000) * claudePrices!.outputUsdPerMTok;
    expect(rows[0]?.cost_usd).toBeCloseTo(expected, 8);
  });

  it("leaves cost_usd NULL for assistant rows whose model isn't in PRICING", async () => {
    handle = await createTestDb({ stopAt: 28 });
    await seedConv("c1");
    // openai_compat has an empty pricing table — every preset row
    // through this provider lands as NULL, per the "?" rule.
    await seedMessage({
      id: "m_compat",
      role: "assistant",
      provider: "openai_compat",
      model: "some-vendor/some-model",
      inputTokens: 1000,
      outputTokens: 500,
      idx: 0,
    });
    // A claude row with an unknown model id also gets NULL — the
    // backfill MUST NOT use the median fallback that estimateCost has
    // for live cost displays. Snapshots should be honest about
    // "we don't know."
    await seedMessage({
      id: "m_unknown_model",
      role: "assistant",
      provider: "claude",
      model: "claude-novel-7b-not-yet-priced",
      inputTokens: 1000,
      outputTokens: 500,
      idx: 1,
    });
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ id: string; cost_usd: number | null }>(
      "SELECT id, cost_usd FROM messages ORDER BY idx",
    );
    expect(rows[0]?.cost_usd).toBeNull();
    expect(rows[1]?.cost_usd).toBeNull();
  });

  it("leaves non-assistant rows NULL even if they happen to have token counts", async () => {
    handle = await createTestDb({ stopAt: 28 });
    await seedConv("c1");
    await seedMessage({
      id: "m_user",
      role: "user",
      provider: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      idx: 0,
    });
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ cost_usd: number | null }>(
      "SELECT cost_usd FROM messages WHERE id = 'm_user'",
    );
    expect(rows[0]?.cost_usd).toBeNull();
  });

  it("handles zero-token assistant rows: still computes as 0, not NULL, when pricing is known", async () => {
    handle = await createTestDb({ stopAt: 28 });
    await seedConv("c1");
    // Empty placeholder rows that completed with zero tokens (e.g.
    // mock provider) should snapshot as 0, distinguishable from
    // genuine pricing-unknown NULLs.
    await seedMessage({
      id: "m_zero",
      role: "assistant",
      provider: "mock",
      model: "mock-1",
      inputTokens: 0,
      outputTokens: 0,
      idx: 0,
    });
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ cost_usd: number | null }>(
      "SELECT cost_usd FROM messages WHERE id = 'm_zero'",
    );
    expect(rows[0]?.cost_usd).toBe(0);
  });
});
