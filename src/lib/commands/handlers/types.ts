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
import type { SendOptions } from "@/hooks/useSend";

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
 * Context passed to every command handler. All store interactions
 * happen through Zustand's .getState() inside the handlers, so only
 * per-invocation values live here.
 */
export interface CommandContext {
  conversation: Conversation;
  /** Original raw text typed by the user (used to restore input on error). */
  rawInput: string;
  send: SendFn;
  retry: RetryFn;
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
