// Pin cleanup when a persona is deleted — issue #21.
import { describe, it, expect } from "vitest";
import { pinMutationsForDeletion } from "@/lib/personas/cleanupOnDeletion";
import { makeMessage } from "@/lib/persistence/messages";

describe("pinMutationsForDeletion", () => {
  it("clears identity pin (pinTarget points at deleted persona)", () => {
    const m = makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "use Foo as your name",
      pinned: true,
      pinTarget: "p_foo",
    });
    const out = pinMutationsForDeletion([m], "p_foo");
    expect(out).toEqual([{ id: m.id, pinned: false, pinTarget: null }]);
  });

  it("unpins a sole-target manual pin (addressedTo == [deleted])", () => {
    const m = makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "be brief",
      pinned: true,
      addressedTo: ["p_foo"],
    });
    const out = pinMutationsForDeletion([m], "p_foo");
    expect(out).toEqual([{ id: m.id, pinned: false }]);
  });

  it("removes target from multi-addressed manual pin, keeps it pinned", () => {
    const m = makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "speak english",
      pinned: true,
      addressedTo: ["p_foo", "p_bar"],
    });
    const out = pinMutationsForDeletion([m], "p_foo");
    expect(out).toEqual([{ id: m.id, addressedTo: ["p_bar"] }]);
  });

  it("leaves non-pinned messages alone (history is immutable)", () => {
    const m = makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "hi",
      pinned: false,
      addressedTo: ["p_foo", "p_bar"],
    });
    expect(pinMutationsForDeletion([m], "p_foo")).toEqual([]);
  });

  it("ignores messages unrelated to the deleted persona", () => {
    const m = makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "hi",
      pinned: true,
      addressedTo: ["p_bar"],
    });
    expect(pinMutationsForDeletion([m], "p_foo")).toEqual([]);
  });

  it("can both clear pinTarget and trim addressedTo for the same message", () => {
    // Edge: identity pin that also has an addressedTo list. Identity-pin
    // semantics dominate (clear pinTarget, set pinned=false); addressedTo
    // adjustments would be moot because the message is no longer pinned.
    const m = makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "x",
      pinned: true,
      pinTarget: "p_foo",
      addressedTo: ["p_foo", "p_bar"],
    });
    const out = pinMutationsForDeletion([m], "p_foo");
    expect(out).toEqual([{ id: m.id, pinned: false, pinTarget: null }]);
  });
});
