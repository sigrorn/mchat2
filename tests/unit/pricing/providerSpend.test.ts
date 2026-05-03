// Provider spend aggregator (#253). Pure helper that rolls up per-row
// USD snapshots into per-provider current-month / last-month / total
// figures with UTC boundaries. The persona-panel spend table renders
// directly from its output.
//
// Cell semantics:
// - usdKnown: sum of cost_usd from rows that had a snapshot.
// - anyUnknown: at least one row in the bucket had a NULL snapshot
//   (renders as "?" in the cell — its cost is genuinely unknown,
//   distinct from $0).
// - anyApproximate (per-provider, not per-cell): at least one row
//   anywhere had usage_estimated=true. Surfaces as " ~" suffix on
//   the provider name.
import { describe, it, expect } from "vitest";
import {
  computeProviderSpend,
  type SpendRow,
} from "@/lib/pricing/providerSpend";

// 2026-05-15 12:00:00 UTC — a "now" anchor that puts current month at
// May 2026 and last month at April 2026.
const NOW = Date.UTC(2026, 4, 15, 12, 0, 0);
const MAY_FIRST = Date.UTC(2026, 4, 1, 0, 0, 0);
const APR_FIRST = Date.UTC(2026, 3, 1, 0, 0, 0);

describe("computeProviderSpend (#253)", () => {
  it("returns an empty map when there are no rows", () => {
    expect(computeProviderSpend([], NOW).size).toBe(0);
  });

  it("buckets known-cost rows into current / last / total", () => {
    // Three rows for one provider: one mid-May (current), one mid-April
    // (last month), one in March (older — counted in total only).
    const rows: SpendRow[] = [
      {
        provider: "claude",
        costUsd: 0.5,
        usageEstimated: false,
        createdAt: Date.UTC(2026, 4, 10, 9, 0, 0),
      },
      {
        provider: "claude",
        costUsd: 0.25,
        usageEstimated: false,
        createdAt: Date.UTC(2026, 3, 20, 9, 0, 0),
      },
      {
        provider: "claude",
        costUsd: 1.0,
        usageEstimated: false,
        createdAt: Date.UTC(2026, 2, 5, 9, 0, 0),
      },
    ];
    const out = computeProviderSpend(rows, NOW);
    const claude = out.get("claude");
    expect(claude).toBeDefined();
    expect(claude!.currentMonth.usdKnown).toBeCloseTo(0.5);
    expect(claude!.lastMonth.usdKnown).toBeCloseTo(0.25);
    expect(claude!.total.usdKnown).toBeCloseTo(1.75);
  });

  it("respects UTC month boundaries — exactly-on-boundary rows go to the new month", () => {
    // A row stamped at the very first millisecond of May 2026 belongs
    // to May (current), not April. The pre-May tick still belongs to
    // last month. Boundary semantics matter for users who watch this
    // table flip on the first of the month.
    const rows: SpendRow[] = [
      {
        provider: "openai",
        costUsd: 1.0,
        usageEstimated: false,
        createdAt: MAY_FIRST,
      },
      {
        provider: "openai",
        costUsd: 2.0,
        usageEstimated: false,
        createdAt: MAY_FIRST - 1,
      },
    ];
    const out = computeProviderSpend(rows, NOW);
    const o = out.get("openai")!;
    expect(o.currentMonth.usdKnown).toBeCloseTo(1.0);
    expect(o.lastMonth.usdKnown).toBeCloseTo(2.0);
  });

  it("flags cells with anyUnknown when at least one contributing row had a null snapshot", () => {
    // openai_compat row at mid-May has no snapshot (NULL → "?" in
    // cell). Total still shows the known portion plus the unknown
    // flag so the renderer can decide how to present it.
    const rows: SpendRow[] = [
      {
        provider: "openai_compat",
        costUsd: null,
        usageEstimated: false,
        createdAt: Date.UTC(2026, 4, 10, 0, 0, 0),
      },
      {
        provider: "openai_compat",
        costUsd: 0.1,
        usageEstimated: false,
        createdAt: Date.UTC(2026, 4, 12, 0, 0, 0),
      },
    ];
    const out = computeProviderSpend(rows, NOW);
    const oc = out.get("openai_compat")!;
    expect(oc.currentMonth.anyUnknown).toBe(true);
    expect(oc.currentMonth.usdKnown).toBeCloseTo(0.1);
    expect(oc.total.anyUnknown).toBe(true);
    expect(oc.lastMonth.anyUnknown).toBe(false);
  });

  it("anyApproximate is per-provider and true if any row had usage_estimated", () => {
    // Provider-name suffix " ~" lights up regardless of which bucket
    // the approximate row landed in.
    const rows: SpendRow[] = [
      {
        provider: "gemini",
        costUsd: 0.05,
        usageEstimated: true,
        createdAt: Date.UTC(2026, 1, 1, 0, 0, 0),
      },
    ];
    const out = computeProviderSpend(rows, NOW);
    expect(out.get("gemini")!.anyApproximate).toBe(true);
  });

  it("groups rows separately per provider", () => {
    const rows: SpendRow[] = [
      {
        provider: "claude",
        costUsd: 0.5,
        usageEstimated: false,
        createdAt: Date.UTC(2026, 4, 10, 0, 0, 0),
      },
      {
        provider: "openai",
        costUsd: 0.25,
        usageEstimated: false,
        createdAt: Date.UTC(2026, 4, 12, 0, 0, 0),
      },
    ];
    const out = computeProviderSpend(rows, NOW);
    expect(out.get("claude")!.currentMonth.usdKnown).toBeCloseTo(0.5);
    expect(out.get("openai")!.currentMonth.usdKnown).toBeCloseTo(0.25);
  });

  it("treats $0 known-cost rows as known (not unknown) — distinguishable from a NULL snapshot", () => {
    // mock provider has known prices that happen to be 0; that's not
    // the same situation as a missing-pricing NULL.
    const rows: SpendRow[] = [
      {
        provider: "mock",
        costUsd: 0,
        usageEstimated: false,
        createdAt: Date.UTC(2026, 4, 10, 0, 0, 0),
      },
    ];
    const out = computeProviderSpend(rows, NOW);
    const m = out.get("mock")!;
    expect(m.currentMonth.usdKnown).toBe(0);
    expect(m.currentMonth.anyUnknown).toBe(false);
  });

  it("handles year-boundary roll-over: January's last month is December of the prior year", () => {
    // Make sure last-month math doesn't degenerate at month=0.
    const janNow = Date.UTC(2027, 0, 15, 12, 0, 0);
    const rows: SpendRow[] = [
      {
        provider: "claude",
        costUsd: 1.0,
        usageEstimated: false,
        createdAt: Date.UTC(2026, 11, 20, 0, 0, 0), // Dec 2026
      },
      {
        provider: "claude",
        costUsd: 2.0,
        usageEstimated: false,
        createdAt: Date.UTC(2027, 0, 5, 0, 0, 0), // Jan 2027
      },
    ];
    const out = computeProviderSpend(rows, janNow);
    expect(out.get("claude")!.currentMonth.usdKnown).toBeCloseTo(2.0);
    expect(out.get("claude")!.lastMonth.usdKnown).toBeCloseTo(1.0);
  });
});

// Boundary helpers — tested independently because the spend table's
// month columns drift visibly when these are wrong, and a user
// living through a UTC midnight rollover is the one most likely to
// notice.
import { utcMonthStart, utcLastMonthStart } from "@/lib/pricing/providerSpend";

describe("utcMonthStart / utcLastMonthStart", () => {
  it("utcMonthStart returns the first ms of the UTC month containing nowMs", () => {
    expect(utcMonthStart(Date.UTC(2026, 4, 15, 12, 0, 0))).toBe(MAY_FIRST);
    expect(utcMonthStart(MAY_FIRST)).toBe(MAY_FIRST);
    expect(utcMonthStart(MAY_FIRST - 1)).toBe(APR_FIRST);
  });

  it("utcLastMonthStart returns the first ms of the previous UTC month", () => {
    expect(utcLastMonthStart(Date.UTC(2026, 4, 15, 12, 0, 0))).toBe(APR_FIRST);
    expect(utcLastMonthStart(MAY_FIRST)).toBe(APR_FIRST);
  });

  it("utcLastMonthStart rolls back the year on a January now", () => {
    const janNow = Date.UTC(2027, 0, 15, 12, 0, 0);
    expect(utcLastMonthStart(janNow)).toBe(Date.UTC(2026, 11, 1, 0, 0, 0));
  });
});
