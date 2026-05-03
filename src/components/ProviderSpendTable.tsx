// ------------------------------------------------------------------
// Component: ProviderSpendTable (#253)
// Responsibility: Render per-provider USD spend (current month / last
//                 month / total, UTC) underneath the persona panel.
//                 Pure-render around computeProviderSpend; data comes
//                 from listSpendRows (#252's snapshot column) and the
//                 keychain (filters out providers without a current
//                 key per the user's rule).
// Collaborators: lib/pricing/providerSpend, lib/persistence/messages
//                (listSpendRows), lib/tauri/keychain, PersonaPanel.
// ------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  computeProviderSpend,
  type ProviderSpend,
  type SpendRow,
} from "@/lib/pricing/providerSpend";
import { useRepoQuery } from "@/lib/data/useRepoQuery";
import * as messagesRepo from "@/lib/persistence/messages";
import { keychain } from "@/lib/tauri/keychain";
import { PROVIDER_REGISTRY, ALL_PROVIDER_IDS } from "@/lib/providers/registry";
import type { ProviderId } from "@/lib/types";

const EMPTY_ROWS: readonly SpendRow[] = Object.freeze([]);

// "$X.XX" rounded to cents when the cell has any known cost; "?" when
// the bucket is non-empty but no row carries a snapshot; "—" when the
// bucket is empty.
//
// #253 follow-up: rounded to two decimals (cents) — sub-cent precision
// matters for token-level math but reads as noise here, and the user
// pays in whole cents anyway. Snapshots stay at full precision in the
// DB; rounding is render-only.
//
// #253 follow-up: dropped the trailing " + ?" suffix on mixed cells.
// The annotation only ever fires for legacy pre-#252 rows that have
// null cost_usd because the column didn't exist when they streamed.
// Future installs never hit that case (every new row gets a snapshot
// at completion), and as the only current user I know which rows
// those are without a marker. Standalone "?" stays — it still
// distinguishes "tracked activity, all unpriced" from "no activity".
function formatCell(cell: { usdKnown: number; anyUnknown: boolean }): string {
  const hasKnown = cell.usdKnown > 0;
  if (!hasKnown && cell.anyUnknown) return "?";
  if (!hasKnown) return "—";
  return `$${cell.usdKnown.toFixed(2)}`;
}

// A provider has a "current API key" iff (a) its adapter doesn't
// require one (mock), or (b) its keychainKey or any sub-keyed entry
// exists in the keychain. The sub-keyed branch covers openai_compat,
// which stores one key per preset (`openai_compat.apiKey.<preset>`).
function providerHasKey(provider: ProviderId, keychainKeys: readonly string[]): boolean {
  const meta = PROVIDER_REGISTRY[provider];
  if (!meta.requiresKey) return true;
  return keychainKeys.some(
    (k) => k === meta.keychainKey || k.startsWith(meta.keychainKey + "."),
  );
}

export function ProviderSpendTable(): JSX.Element | null {
  const spendQuery = useRepoQuery<readonly SpendRow[]>(
    ["spend-rows"],
    async () => {
      const rows = await messagesRepo.listSpendRows();
      return rows.map((r) => ({
        provider: r.provider,
        costUsd: r.costUsd,
        usageEstimated: r.usageEstimated,
        createdAt: r.createdAt,
      }));
    },
  );
  const rows = spendQuery.data ?? EMPTY_ROWS;

  // Keychain isn't reactive — load once + reload when this component
  // mounts (the persona panel re-renders on conversation switches).
  const [keychainKeys, setKeychainKeys] = useState<readonly string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void keychain
      .list()
      .then((ks) => {
        if (!cancelled) setKeychainKeys(ks);
      })
      .catch(() => {
        if (!cancelled) setKeychainKeys([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleProviders = useMemo(
    () =>
      // #253 follow-up: hide `mock` from the spend table. It has
      // requiresKey=false so the keychain filter passes it through,
      // but the provider only exists for adapter testing — never used
      // by end users. The keychain check still gates every other
      // provider as before.
      ALL_PROVIDER_IDS.filter((p) => p !== "mock" && providerHasKey(p, keychainKeys)),
    [keychainKeys],
  );

  const spendMap = useMemo(() => computeProviderSpend(rows, Date.now()), [rows]);

  const visible: ProviderSpend[] = useMemo(
    () =>
      visibleProviders
        .map((p) => spendMap.get(p) ?? emptySpend(p))
        .sort((a, b) => a.provider.localeCompare(b.provider)),
    [visibleProviders, spendMap],
  );

  if (visible.length === 0) return null;

  return (
    <div className="mt-3 border-t border-neutral-200 pt-3">
      <div className="mb-1 text-xs font-medium text-neutral-700">Spend (USD)</div>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="font-normal">Provider</th>
            <th className="text-right font-normal">This month</th>
            <th className="text-right font-normal">Last month</th>
            <th className="text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => (
            // #253 follow-up: hoist text-neutral-800 onto the row so
            // every cell inherits it. Originally only the provider-
            // name <td> set the colour, leaving the three value cells
            // inheriting from PersonaPanel's faint cascade — values
            // were technically rendered but invisible until selected.
            <tr key={s.provider} className="text-neutral-800">
              <td>
                {PROVIDER_REGISTRY[s.provider].displayName}
                {s.anyApproximate ? " ~" : ""}
              </td>
              {/* #253 follow-up: whitespace-nowrap on value cells.
                  Without this, "$X.XX + ?" wrapped inside a narrow
                  persona-panel column, growing the row taller and
                  visually colliding with the next provider's cells.
                  Letting the column auto-widen is fine — the panel
                  has plenty of horizontal room. */}
              <td className="whitespace-nowrap text-right">{formatCell(s.currentMonth)}</td>
              <td className="whitespace-nowrap text-right">{formatCell(s.lastMonth)}</td>
              <td className="whitespace-nowrap text-right">{formatCell(s.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 text-[10px] text-neutral-400">
        UTC month boundaries. ~ = some token counts were estimated by the adapter.
      </div>
    </div>
  );
}

function emptySpend(provider: ProviderId): ProviderSpend {
  return {
    provider,
    anyApproximate: false,
    currentMonth: { usdKnown: 0, anyUnknown: false },
    lastMonth: { usdKnown: 0, anyUnknown: false },
    total: { usdKnown: 0, anyUnknown: false },
  };
}
