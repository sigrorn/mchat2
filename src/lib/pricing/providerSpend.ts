// ------------------------------------------------------------------
// Component: Provider spend aggregator (#253)
// Responsibility: Pure roll-up that turns a flat list of assistant-row
//                 cost snapshots into per-provider current-month /
//                 last-month / total figures with UTC boundaries.
//                 Drives the persona-panel spend table without
//                 touching the DB or React directly.
// Collaborators: pricing/estimator.ts (snapshot source via #252),
//                persistence/spend.ts (row source),
//                components/ProviderSpendTable.tsx.
// ------------------------------------------------------------------

import type { ProviderId } from "../types";

// Minimal row shape consumed by the helper — projected from the
// messages table by the spend repo function. Keeping this separate
// from the full Message type lets the SQL select only the columns
// the table needs.
export interface SpendRow {
  provider: ProviderId;
  // null = pricing was unknown when this row was snapshotted (#252).
  // Distinct from 0 (which is a known $0 cost — e.g. mock provider
  // or a free-tier model with explicit zero rates in PRICING).
  costUsd: number | null;
  usageEstimated: boolean;
  createdAt: number;
}

export interface SpendCell {
  // Sum of cost_usd from rows in the bucket whose snapshot is known.
  usdKnown: number;
  // True iff at least one row in the bucket had a NULL snapshot.
  // The renderer shows "?" when this is true and there are no known
  // rows, or "$X.XX (+ ?)" when it's mixed.
  anyUnknown: boolean;
}

export interface ProviderSpend {
  provider: ProviderId;
  // True iff any row anywhere in the provider's history had a
  // server-estimated token count. Surfaces as the " ~" suffix on
  // the provider name in the spend table.
  anyApproximate: boolean;
  currentMonth: SpendCell;
  lastMonth: SpendCell;
  total: SpendCell;
}

// First ms of the UTC month containing `nowMs`. Sliding "current
// month" anchor for the spend table; rows >= this stamp count as
// current. Tests pin exact-on-boundary behaviour because that's
// the moment the user notices the table flipping.
export function utcMonthStart(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

// First ms of the UTC month before the one containing `nowMs`. Rolls
// the year back at January.
export function utcLastMonthStart(nowMs: number): number {
  const d = new Date(nowMs);
  const m = d.getUTCMonth();
  if (m === 0) return Date.UTC(d.getUTCFullYear() - 1, 11, 1, 0, 0, 0, 0);
  return Date.UTC(d.getUTCFullYear(), m - 1, 1, 0, 0, 0, 0);
}

function emptyCell(): SpendCell {
  return { usdKnown: 0, anyUnknown: false };
}

function addToCell(cell: SpendCell, row: SpendRow): void {
  if (row.costUsd === null) {
    cell.anyUnknown = true;
  } else {
    cell.usdKnown += row.costUsd;
  }
}

export function computeProviderSpend(
  rows: readonly SpendRow[],
  nowMs: number,
): Map<ProviderId, ProviderSpend> {
  const currentStart = utcMonthStart(nowMs);
  const lastStart = utcLastMonthStart(nowMs);
  const out = new Map<ProviderId, ProviderSpend>();
  for (const row of rows) {
    let entry = out.get(row.provider);
    if (!entry) {
      entry = {
        provider: row.provider,
        anyApproximate: false,
        currentMonth: emptyCell(),
        lastMonth: emptyCell(),
        total: emptyCell(),
      };
      out.set(row.provider, entry);
    }
    if (row.usageEstimated) entry.anyApproximate = true;
    addToCell(entry.total, row);
    if (row.createdAt >= currentStart) {
      addToCell(entry.currentMonth, row);
    } else if (row.createdAt >= lastStart) {
      addToCell(entry.lastMonth, row);
    }
  }
  return out;
}
