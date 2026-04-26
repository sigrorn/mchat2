// ------------------------------------------------------------------
// Component: useSend hook
// Responsibility: Thin React adapter around the lib/app send/retry/
//                 replay use cases. Wires deps from Zustand stores
//                 and exposes the action surface to the UI.
// Collaborators: lib/app/sendMessage, lib/app/retryMessage,
//                lib/app/replayMessage, the *Deps factories under
//                this directory.
// ------------------------------------------------------------------

import { useCallback } from "react";
import type { Conversation, Message } from "@/lib/types";
import { sendMessage } from "@/lib/app/sendMessage";
import { retryMessage } from "@/lib/app/retryMessage";
import { replayMessage } from "@/lib/app/replayMessage";
import { makeRetryMessageDeps, makeReplayMessageDeps } from "./runOneTargetDeps";
import { makeSendMessageDeps } from "./sendMessageDeps";

export interface SendOptions {
  pinned?: boolean;
}

export function useSend(conversation: Conversation) {
  const send = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      const result = await sendMessage(makeSendMessageDeps(), {
        conversation,
        text,
        ...(opts.pinned !== undefined ? { pinned: opts.pinned } : {}),
      });
      return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
    },
    [conversation],
  );

  const retry = useCallback(
    async (failed: Message) => {
      const result = await retryMessage(makeRetryMessageDeps(), { conversation, failed });
      return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
    },
    [conversation],
  );

  const replay = useCallback(
    async (messageId: string, newContent: string) => {
      const result = await replayMessage(makeReplayMessageDeps(), {
        conversation,
        messageId,
        newContent,
      });
      return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
    },
    [conversation],
  );

  return { send, retry, replay };
}
