// #271 first slice — setSelection moves out of the personasStore as a
// cross-store call into a lib/app use case. After this:
//
// - personasStore.setSelection / addToSelection update local UI state
//   only and do NOT depend on useConversationsStore.
// - The persistent write goes through setSelection() in lib/app, which
//   takes deps for both the local cache update and the persistent
//   write.
//
// Both halves are pinned here.
import { describe, it, expect, vi } from "vitest";
import { setSelection } from "@/lib/app/setSelection";

describe("lib/app/setSelection (#271)", () => {
  it("updates local cache then writes persistent state, in that order", async () => {
    const order: string[] = [];
    const setLocalSelection = vi.fn((_id: string, _keys: string[]) => {
      order.push("local");
    });
    const setSelectedPersonasPersistent = vi.fn(async (_id: string, _keys: string[]) => {
      order.push("persistent");
    });
    await setSelection(
      { setLocalSelection, setSelectedPersonasPersistent },
      "c1",
      ["p1", "p2"],
    );
    expect(setLocalSelection).toHaveBeenCalledWith("c1", ["p1", "p2"]);
    expect(setSelectedPersonasPersistent).toHaveBeenCalledWith("c1", ["p1", "p2"]);
    // Local-first: keep UI snappy; persistence follows.
    expect(order).toEqual(["local", "persistent"]);
  });

  it("propagates persistence errors so the caller can decide UX", async () => {
    const setLocalSelection = vi.fn();
    const setSelectedPersonasPersistent = vi.fn(async () => {
      throw new Error("DB locked");
    });
    await expect(
      setSelection({ setLocalSelection, setSelectedPersonasPersistent }, "c1", ["p1"]),
    ).rejects.toThrow("DB locked");
    // Local update still landed (UI is best-effort, the user moved on).
    expect(setLocalSelection).toHaveBeenCalled();
  });
});

describe("personasStore.setSelection no longer depends on useConversationsStore (#271)", () => {
  it("does not call useConversationsStore.setSelectedPersonas", async () => {
    // Import here so the spy is set up before the store reads anything.
    const { usePersonasStore } = await import("@/stores/personasStore");
    const { useConversationsStore } = await import("@/stores/conversationsStore");
    const spy = vi
      .spyOn(useConversationsStore.getState(), "setSelectedPersonas")
      .mockResolvedValue(undefined);

    usePersonasStore.getState().setSelection("c1", ["p1", "p2"]);
    // Microtask flush in case there's deferred work.
    await Promise.resolve();
    await Promise.resolve();

    expect(spy).not.toHaveBeenCalled();
    expect(usePersonasStore.getState().selectionByConversation["c1"]).toEqual([
      "p1",
      "p2",
    ]);
    spy.mockRestore();
  });
});
