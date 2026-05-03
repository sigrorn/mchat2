// ------------------------------------------------------------------
// Component: Apertus keychain cleanup (#259 Phase D)
// Responsibility: One-shot launch-time best-effort removal of the
//                 orphaned apertus_api_key keychain entry left over
//                 from the legacy native adapter. Phase 0 already
//                 mirrored its value to openai_compat.infomaniak.apiKey
//                 if that slot was empty; the original entry is
//                 inert post-Phase B (the adapter that read it is
//                 gone). Removing it here closes the loop so the
//                 keychain isn't littered with dead app-prefixed
//                 entries.
// Collaborators: src/main.tsx (called from boot, gated on inTauri).
// ------------------------------------------------------------------

import { keychain } from "../tauri/keychain";

const APERTUS_API_KEY = "apertus_api_key";
const APERTUS_PRODUCT_ID_SETTING_KEY = "apertus.productId";

export async function dropApertusKeychainResidue(): Promise<void> {
  try {
    const existing = await keychain.get(APERTUS_API_KEY);
    if (existing !== null) {
      await keychain.remove(APERTUS_API_KEY);
    }
  } catch {
    // Best-effort: if the keychain plugin can't reach the OS store,
    // leaving the orphan in place is harmless. Phase 0 mirrored its
    // value already; the residue can wait for next launch.
  }
  try {
    const existing = await keychain.get(APERTUS_PRODUCT_ID_SETTING_KEY);
    if (existing !== null) {
      await keychain.remove(APERTUS_PRODUCT_ID_SETTING_KEY);
    }
  } catch {
    // Same rationale.
  }
}
