// Per-persona stream status in sendStore — issue #31.
import { describe, it, expect, beforeEach } from "vitest";
import { useSendStore } from "@/stores/sendStore";

beforeEach(() => {
  useSendStore.setState({
    runIdByConversation: {},
    activeByConversation: {},
    streamStatusByConversation: {},
    submittingByConversation: {},
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

// #249: Composer's "is the user currently submitting?" lock used to be
// local component state (a single useState in Composer.tsx). Because
// ChatView doesn't remount on conversation switch, that single flag
// followed the user from one conversation to another — a streaming
// send in conv A locked the Send button in conv B. Move the lock to
// per-conversation store state so each conversation's Composer
// renders its own busy/idle status.
describe("sendStore.submittingByConversation (#249)", () => {
  it("setSubmitting flips the per-conversation flag", () => {
    useSendStore.getState().setSubmitting("c_A", true);
    expect(useSendStore.getState().submittingByConversation["c_A"]).toBe(true);
    useSendStore.getState().setSubmitting("c_A", false);
    expect(useSendStore.getState().submittingByConversation["c_A"]).toBe(false);
  });

  it("does not bleed across conversations (#249 regression)", () => {
    // Conv A is mid-prelude (submitting=true). Conv B should remain
    // idle so its Composer's Send button stays enabled.
    useSendStore.getState().setSubmitting("c_A", true);
    expect(useSendStore.getState().submittingByConversation["c_A"]).toBe(true);
    expect(useSendStore.getState().submittingByConversation["c_B"] ?? false).toBe(false);
  });

  it("setSubmitting can be unset to release the lock", () => {
    // The Composer's onSend uses try/finally to clear submitting after
    // send() resolves; verify the false-write reaches the map.
    useSendStore.getState().setSubmitting("c_A", true);
    useSendStore.getState().setSubmitting("c_A", false);
    expect(useSendStore.getState().submittingByConversation["c_A"]).toBe(false);
  });
});
