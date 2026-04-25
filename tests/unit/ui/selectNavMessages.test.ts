// Header arrows can navigate either user messages (default) or
// messages authored by a specific persona — issue #137 follow-on.
import { describe, it, expect } from "vitest";
import { selectNavMessageIds, navTooltipText } from "@/lib/ui/userMessageNav";
import type { Message } from "@/lib/types";

const mk = (overrides: Partial<Message>): Message => ({
  id: "m",
  conversationId: "c",
  role: "user",
  content: "",
  provider: null,
  model: null,
  personaId: null,
  displayMode: "lines",
  pinned: false,
  pinTarget: null,
  addressedTo: [],
  audience: [],
  createdAt: 0,
  index: 0,
  errorMessage: null,
  errorTransient: false,
  ...overrides,
});

describe("selectNavMessageIds", () => {
  const messages: Message[] = [
    mk({ id: "u1", role: "user" }),
    mk({ id: "a1p", role: "assistant", personaId: "p" }),
    mk({ id: "a1q", role: "assistant", personaId: "q" }),
    mk({ id: "u2", role: "user" }),
    mk({ id: "a2p", role: "assistant", personaId: "p" }),
    mk({ id: "n1", role: "notice" }),
    mk({ id: "u3", role: "user" }),
  ];

  it("with no persona selected, returns the IDs of user messages", () => {
    expect(selectNavMessageIds(messages, null)).toEqual(["u1", "u2", "u3"]);
  });

  it("with a persona selected, returns assistant messages from that persona", () => {
    expect(selectNavMessageIds(messages, "p")).toEqual(["a1p", "a2p"]);
  });

  it("ignores messages from other personas when one is selected", () => {
    expect(selectNavMessageIds(messages, "q")).toEqual(["a1q"]);
  });

  it("returns empty when the selected persona has no messages yet", () => {
    expect(selectNavMessageIds(messages, "z")).toEqual([]);
  });

  it("excludes notice rows in either mode", () => {
    expect(selectNavMessageIds(messages, null)).not.toContain("n1");
    expect(selectNavMessageIds(messages, "p")).not.toContain("n1");
  });
});

describe("navTooltipText", () => {
  it("default tooltip mentions user commands", () => {
    expect(navTooltipText("prev", null)).toMatch(/previous user command/i);
    expect(navTooltipText("next", null)).toMatch(/next user command/i);
  });

  it("when a persona is selected, tooltip mentions that persona", () => {
    expect(navTooltipText("prev", "Alice")).toMatch(/previous message from alice/i);
    expect(navTooltipText("next", "Alice")).toMatch(/next message from alice/i);
  });

  it("tooltip includes the keyboard shortcut", () => {
    expect(navTooltipText("prev", null)).toContain("Ctrl+Shift+Up");
    expect(navTooltipText("next", null)).toContain("Ctrl+Shift+Down");
    expect(navTooltipText("prev", "Alice")).toContain("Ctrl+Shift+Up");
  });
});
