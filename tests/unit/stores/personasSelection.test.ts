// addToSelection helper on personasStore — issue #37.
import { describe, it, expect, beforeEach } from "vitest";
import { usePersonasStore } from "@/stores/personasStore";

beforeEach(() => {
  usePersonasStore.setState({
    byConversation: {},
    selectionByConversation: {},
  });
});

describe("personasStore.addToSelection", () => {
  it("appends ids to an empty selection", () => {
    usePersonasStore.getState().addToSelection("c_1", ["p_a", "p_b"]);
    expect(usePersonasStore.getState().selectionByConversation["c_1"]).toEqual(["p_a", "p_b"]);
  });

  it("appends to an existing selection", () => {
    usePersonasStore.getState().setSelection("c_1", ["p_a"]);
    usePersonasStore.getState().addToSelection("c_1", ["p_b", "p_c"]);
    expect(usePersonasStore.getState().selectionByConversation["c_1"]).toEqual([
      "p_a",
      "p_b",
      "p_c",
    ]);
  });

  it("dedupes ids that are already selected", () => {
    usePersonasStore.getState().setSelection("c_1", ["p_a", "p_b"]);
    usePersonasStore.getState().addToSelection("c_1", ["p_b", "p_c"]);
    expect(usePersonasStore.getState().selectionByConversation["c_1"]).toEqual([
      "p_a",
      "p_b",
      "p_c",
    ]);
  });

  it("scopes per-conversation", () => {
    usePersonasStore.getState().setSelection("c_1", ["p_a"]);
    usePersonasStore.getState().addToSelection("c_2", ["p_x"]);
    expect(usePersonasStore.getState().selectionByConversation["c_1"]).toEqual(["p_a"]);
    expect(usePersonasStore.getState().selectionByConversation["c_2"]).toEqual(["p_x"]);
  });
});
