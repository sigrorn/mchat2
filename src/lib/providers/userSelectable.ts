// ------------------------------------------------------------------
// Component: User-selectable providers
// Responsibility: Trim ALL_PROVIDER_IDS to the set the user should see
//                 in dropdowns. The mock adapter stays registered for
//                 tests but is hidden from production builds (#24).
// Collaborators: components/PersonaPanel.tsx.
// ------------------------------------------------------------------

import type { ProviderId } from "../types";
import { ALL_PROVIDER_IDS } from "./registry";

export function userSelectableProviderIds(includeMock: boolean): ProviderId[] {
  return ALL_PROVIDER_IDS.filter((id) => {
    if (id === "mock" && !includeMock) return false;
    // #256 Phase A: hide the legacy native apertus provider from new-
    // persona pickers. Existing apertus personas auto-converted to
    // openai_compat (Infomaniak preset) in Phase 0; users wanting the
    // Infomaniak endpoint pick openai_compat + the Infomaniak preset.
    if (id === "apertus") return false;
    return true;
  });
}
