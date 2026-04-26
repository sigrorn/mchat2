// ------------------------------------------------------------------
// Component: sendMessage (lib/app)
// Responsibility: The full "send this user text" use case. Resolves
//                 @-targets, persists the user row, runs the planned
//                 send via runPlannedSend, fires the post-response
//                 autocompact / context-warning check, and kicks off
//                 the auto-title flow on first reply (#54). Originally
//                 part of useSend.send; lifted here in #151.
// Collaborators: lib/personas/resolver, lib/conversations/autoTitle,
//                lib/app/runPlannedSend, lib/app/postResponseCheck,
//                lib/app/sendSelection, hooks/useSend (wires deps).
// ------------------------------------------------------------------

import type { Conversation } from "@/lib/types";
import { resolveTargets } from "@/lib/personas/resolver";
import { generateTitle } from "@/lib/conversations/autoTitle";
import { modelForTarget } from "@/lib/orchestration/streamRunner";
import { adapterFor } from "@/lib/providers/registryOfAdapters";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { keychain } from "@/lib/tauri/keychain";
import { selectionAfterResolve } from "./sendSelection";
import { runPlannedSend } from "./runPlannedSend";
import { postResponseCheck } from "./postResponseCheck";
import type { SendMessageDeps } from "./deps";

export interface SendMessageArgs {
  conversation: Conversation;
  text: string;
  pinned?: boolean;
}

export type SendMessageResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function sendMessage(
  deps: SendMessageDeps,
  args: SendMessageArgs,
): Promise<SendMessageResult> {
  const { conversation, text, pinned } = args;
  const personas = deps.getPersonas(conversation.id);
  const selection = deps.getSelection(conversation.id);

  const resolved = resolveTargets({
    text,
    personas: [...personas],
    selection: [...selection],
  });
  if (resolved.unknown.length > 0) {
    return {
      ok: false,
      reason: `unknown target${resolved.unknown.length === 1 ? "" : "s"}: ${resolved.unknown
        .map((u) => `@${u}`)
        .join(", ")}`,
    };
  }
  if (resolved.targets.length === 0) return { ok: false, reason: "no targets" };

  if (resolved.mode !== "implicit") {
    const nextSelection = selectionAfterResolve(resolved, [...selection]);
    deps.setSelection(conversation.id, nextSelection);
  }

  // #130: always persist the resolved target list. Implicit sends used
  // to store [], which made assistant replies' audience empty and
  // broke cols-mode grouping. userHeader keeps the "@all" shorthand
  // when the list covers every active persona.
  const addressedTo = resolved.targets.map((t) => t.key);

  await deps.appendUserMessage({
    conversationId: conversation.id,
    content: resolved.strippedText,
    addressedTo,
    pinned: pinned ?? false,
  });

  const result = await runPlannedSend(deps, { conversation, resolved, personas });
  if (!result.ok) return { ok: false, reason: result.reason };

  // #105: post-response autocompact / context warnings.
  void postResponseCheck(deps, conversation.id);

  // #54: auto-title — fire-and-forget after the first user/assistant
  // exchange of a fresh conversation.
  if (conversation.title === "New conversation") {
    const freshHistory = deps.getMessages(conversation.id);
    const firstUser = freshHistory.find((m) => m.role === "user" && !m.pinned);
    const firstAssistant = freshHistory.find(
      (m) => m.role === "assistant" && !m.errorMessage && m.content,
    );
    if (firstUser && firstAssistant) {
      const titleTarget = result.allTargets[0];
      if (titleTarget) {
        void (async () => {
          try {
            const ak = PROVIDER_REGISTRY[titleTarget.provider].requiresKey
              ? await keychain.get(PROVIDER_REGISTRY[titleTarget.provider].keychainKey)
              : null;
            const title = await generateTitle(
              adapterFor(titleTarget.provider),
              ak,
              modelForTarget(titleTarget, [...personas]),
              firstUser.content,
              firstAssistant.content,
            );
            if (title) {
              await deps.rename(conversation.id, title);
            }
          } catch {
            // Silent discard — auto-title is best-effort.
          }
        })();
      }
    }
  }

  return { ok: true };
}
