// invoke()-backed OS keychain impl — issue #35.
import { describe, it, expect, vi } from "vitest";
import { makeOsKeychainImpl } from "@/lib/tauri/keychainOs";

describe("makeOsKeychainImpl", () => {
  it("get dispatches keychain_get with the key", async () => {
    const invoke = vi.fn().mockResolvedValue("secret");
    const impl = makeOsKeychainImpl(invoke);
    const v = await impl.get("anthropic.apiKey");
    expect(v).toBe("secret");
    expect(invoke).toHaveBeenCalledWith("keychain_get", { key: "anthropic.apiKey" });
  });

  it("get returns null when Rust returns null (NoEntry)", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const impl = makeOsKeychainImpl(invoke);
    expect(await impl.get("missing")).toBeNull();
  });

  it("set dispatches keychain_set with key and value", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const impl = makeOsKeychainImpl(invoke);
    await impl.set("openai.apiKey", "sk-123");
    expect(invoke).toHaveBeenCalledWith("keychain_set", {
      key: "openai.apiKey",
      value: "sk-123",
    });
  });

  it("remove dispatches keychain_remove", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const impl = makeOsKeychainImpl(invoke);
    await impl.remove("openai.apiKey");
    expect(invoke).toHaveBeenCalledWith("keychain_remove", { key: "openai.apiKey" });
  });

  it("list dispatches keychain_list and returns the array", async () => {
    const invoke = vi.fn().mockResolvedValue(["anthropic.apiKey", "openai.apiKey"]);
    const impl = makeOsKeychainImpl(invoke);
    const keys = await impl.list();
    expect(keys).toEqual(["anthropic.apiKey", "openai.apiKey"]);
    expect(invoke).toHaveBeenCalledWith("keychain_list");
  });
});
