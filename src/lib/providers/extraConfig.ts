// ------------------------------------------------------------------
// Component: Extra config resolver
// Responsibility: Build the provider-specific extraConfig object for
//                 a given persona. Currently only Apertus uses this
//                 (for its Product-Id).
// Collaborators: hooks/runOneTarget.ts, conversations/compact.ts.
// ------------------------------------------------------------------

import type { Persona } from "../types";
import { getSetting } from "../persistence/settings";
import { APERTUS_PRODUCT_ID_KEY } from "../settings/keys";

export async function resolveExtraConfig(
  provider: string,
  persona: Persona | null,
): Promise<Record<string, unknown> | undefined> {
  if (provider !== "apertus") return undefined;
  const globalProductId = await getSetting(APERTUS_PRODUCT_ID_KEY);
  const productId = globalProductId?.trim() || persona?.apertusProductId || null;
  if (!productId) return undefined;
  return { productId };
}
