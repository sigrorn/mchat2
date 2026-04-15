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
  return ALL_PROVIDER_IDS.filter((id) => includeMock || id !== "mock");
}
