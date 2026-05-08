// ------------------------------------------------------------------
// Component: Flows store
// Responsibility: Surface flow writes (upsertFlow, deleteFlow) so
//                 components don't import lib/persistence/flows
//                 directly (#287, sub-issue #290). Reads still go
//                 through repoQueryCache via useRepoQuery; phase 2
//                 of #287 will move read sites here too.
// Collaborators: persistence/flows.ts, data/useRepoQuery.ts.
// ------------------------------------------------------------------

import { create } from "zustand";
import type { FlowDraft } from "@/lib/types";
import * as repo from "@/lib/persistence/flows";
import { invalidateRepoQuery } from "@/lib/data/useRepoQuery";

interface State {
  upsertFlow: (conversationId: string, draft: FlowDraft) => Promise<void>;
  deleteFlow: (conversationId: string) => Promise<void>;
}

export const useFlowsStore = create<State>(() => ({
  async upsertFlow(conversationId, draft) {
    await repo.upsertFlow(conversationId, draft);
    invalidateRepoQuery(["flow"]);
  },
  async deleteFlow(conversationId) {
    await repo.deleteFlow(conversationId);
    invalidateRepoQuery(["flow"]);
  },
}));
