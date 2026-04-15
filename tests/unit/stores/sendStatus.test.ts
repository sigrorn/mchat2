// Per-persona stream status in sendStore — issue #31.
import { describe, it, expect, beforeEach } from "vitest";
import { useSendStore } from "@/stores/sendStore";

beforeEach(() => {
  useSendStore.setState({
    runIdByConversation: {},
    activeByConversation: {},
    streamStatusByConversation: {},
  });
});

describe("sendStore stream status", () => {
  it("setTargetStatus stores the status by conversation+persona key", () => {
    useSendStore.getState().setTargetStatus("c_1", "p_a", "queued");
    useSendStore.getState().setTargetStatus("c_1", "p_b", "streaming");
    const map = useSendStore.getState().streamStatusByConversation["c_1"] ?? {};
    expect(map["p_a"]).toBe("queued");
    expect(map["p_b"]).toBe("streaming");
  });

  it("setTargetStatus overwrites: queued -> streaming -> retrying", () => {
    useSendStore.getState().setTargetStatus("c_1", "p_a", "queued");
    useSendStore.getState().setTargetStatus("c_1", "p_a", "streaming");
    useSendStore.getState().setTargetStatus("c_1", "p_a", "retrying");
    expect(useSendStore.getState().streamStatusByConversation["c_1"]?.["p_a"]).toBe("retrying");
  });

  it("clearTargetStatus removes a single persona entry", () => {
    useSendStore.getState().setTargetStatus("c_1", "p_a", "streaming");
    useSendStore.getState().setTargetStatus("c_1", "p_b", "streaming");
    useSendStore.getState().clearTargetStatus("c_1", "p_a");
    const map = useSendStore.getState().streamStatusByConversation["c_1"] ?? {};
    expect(map["p_a"]).toBeUndefined();
    expect(map["p_b"]).toBe("streaming");
  });

  it("cancelAll clears all statuses for the conversation", () => {
    useSendStore.getState().setTargetStatus("c_1", "p_a", "streaming");
    useSendStore.getState().setTargetStatus("c_1", "p_b", "queued");
    useSendStore.getState().cancelAll("c_1");
    const map = useSendStore.getState().streamStatusByConversation["c_1"] ?? {};
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("cancelAll on one conversation does not affect another", () => {
    useSendStore.getState().setTargetStatus("c_1", "p_a", "streaming");
    useSendStore.getState().setTargetStatus("c_2", "p_x", "streaming");
    useSendStore.getState().cancelAll("c_1");
    expect(useSendStore.getState().streamStatusByConversation["c_2"]?.["p_x"]).toBe("streaming");
  });
});
