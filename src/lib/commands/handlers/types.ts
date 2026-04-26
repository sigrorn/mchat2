// ------------------------------------------------------------------
// Component: Command handler types
// Responsibility: Shared types for the domain-specific command
//                 handler modules (#114). Each handler receives a
//                 CommandContext and returns a CommandResult (or void)
//                 that the Composer uses to update its text input or
//                 inline hint.
// Collaborators: lib/commands/handlers/*, lib/commands/dispatch.ts,
//                components/Composer.tsx.
// ------------------------------------------------------------------

import type { Conversation, Message } from "@/lib/types";
import type { CommandDeps } from "@/lib/app/deps";

// SendOptions duplicated here to keep this file boundary-clean
// (cannot import from @/hooks/* under #142). The shape mirrors
// hooks/useSend.SendOptions.
export interface SendOptions {
  pinned?: boolean;
}

export interface SendFn {
  (text: string, opts?: SendOptions): Promise<
    | { ok: true }
    | { ok: false; reason: string }
  >;
}

export interface RetryFn {
  (failed: Message): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/**
 * Context passed to every command handler. Store interactions go
 * through `deps` (#154) — handlers must not import stores directly.
 */
export interface CommandContext {
  conversation: Conversation;
  /** Original raw text typed by the user (used to restore input on error). */
  rawInput: string;
  send: SendFn;
  retry: RetryFn;
  deps: CommandDeps;
}

/**
 * Optional directives a handler returns to the Composer. Any unset
 * field means "leave the UI state alone".
 */
export interface CommandResult {
  /** Put this string back into the composer text input (usually rawInput on error). */
  restoreText?: string;
  /** Display this hint above the composer input. */
  hint?: string;
}
