// Sidebar unread indicator — issue #250.
//
// Pure predicate that decides whether a conversation row in the sidebar
// gets the unread dot. Inputs are the conversation's persisted
// last_message_at (advanced on every appendMessage) and last_seen_at
// (stamped to Date.now() when ChatView activates the conversation),
// plus whether this conversation is currently the active one — the
// active conversation never shows the dot, even if a stream just
// landed a new placeholder, because the user is by definition looking
// at it.
import { describe, it, expect } from "vitest";
import { hasUnread } from "@/lib/conversations/unread";

describe("hasUnread (#250)", () => {
  it("returns false for the active conversation regardless of timestamps", () => {
    // The user is reading this conversation right now; a fresh
    // streaming token landing in it shouldn't show as unread.
    expect(hasUnread({ lastMessageAt: 1000, lastSeenAt: 0, isActive: true })).toBe(false);
    expect(hasUnread({ lastMessageAt: 0, lastSeenAt: 0, isActive: true })).toBe(false);
  });

  it("returns true when a message is newer than the last seen stamp", () => {
    expect(hasUnread({ lastMessageAt: 1000, lastSeenAt: 500, isActive: false })).toBe(true);
  });

  it("returns false when last seen is at or past the last message", () => {
    // Equality covers the case where ChatView stamped lastSeenAt
    // immediately after a message landed — the dot should clear, not
    // hover one tick.
    expect(hasUnread({ lastMessageAt: 1000, lastSeenAt: 1000, isActive: false })).toBe(false);
    expect(hasUnread({ lastMessageAt: 500, lastSeenAt: 1000, isActive: false })).toBe(false);
  });

  it("returns false for a conversation that has never had a message", () => {
    // Migration backfills last_message_at from MAX(created_at) over
    // existing messages, defaulting to 0 when none exist. A fresh
    // empty conversation should not show as unread.
    expect(hasUnread({ lastMessageAt: 0, lastSeenAt: 0, isActive: false })).toBe(false);
  });

  it("returns true when last_message_at advances past a previously-cleared mark", () => {
    // Sequence: user reads conv A (lastSeenAt=500), switches away;
    // a new assistant placeholder lands at t=1500 (lastMessageAt=1500).
    // Sidebar should now show the dot.
    expect(hasUnread({ lastMessageAt: 1500, lastSeenAt: 500, isActive: false })).toBe(true);
  });
});
