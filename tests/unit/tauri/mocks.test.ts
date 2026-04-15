import { describe, it, expect, beforeEach } from "vitest";
import { keychain, __setImpl as setKc, __resetImpl as resetKc } from "@/lib/tauri/keychain";
import { sql, __setImpl as setSql, __resetImpl as resetSql } from "@/lib/tauri/sql";
import { fs, __setImpl as setFs, __resetImpl as resetFs } from "@/lib/tauri/filesystem";
import { lifecycle, __setImpl as setLc, __resetImpl as resetLc } from "@/lib/tauri/lifecycle";

describe("keychain mock", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    setKc({
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => {
        store.set(k, v);
      },
      remove: async (k) => {
        store.delete(k);
      },
      list: async () => [...store.keys()],
    });
  });

  it("round-trips keys", async () => {
    await keychain.set("claude", "sk-x");
    expect(await keychain.get("claude")).toBe("sk-x");
    expect(await keychain.list()).toEqual(["claude"]);
    await keychain.remove("claude");
    expect(await keychain.get("claude")).toBeNull();
    resetKc();
  });
});

describe("sql mock", () => {
  it("delegates execute and select", async () => {
    const calls: string[] = [];
    setSql({
      execute: async (q) => {
        calls.push(q);
        return { rowsAffected: 1, lastInsertId: 42 };
      },
      select: async <T>(q: string) => {
        calls.push(q);
        return [{ x: 1 } as unknown as T];
      },
      close: async () => {},
    });
    const e = await sql.execute("INSERT");
    const s = await sql.select<{ x: number }>("SELECT");
    expect(e.lastInsertId).toBe(42);
    expect(s[0]?.x).toBe(1);
    expect(calls).toEqual(["INSERT", "SELECT"]);
    resetSql();
  });
});

describe("fs mock", () => {
  it("round-trips text", async () => {
    const store = new Map<string, string>();
    setFs({
      readText: async (p) => store.get(p) ?? "",
      writeText: async (p, c) => {
        store.set(p, c);
      },
      readBinary: async () => new Uint8Array(),
      writeBinary: async () => {},
      exists: async (p) => store.has(p),
      saveDialog: async () => "/tmp/x",
      openDialog: async () => null,
    });
    await fs.writeText("/a", "hi");
    expect(await fs.readText("/a")).toBe("hi");
    expect(await fs.exists("/a")).toBe(true);
    expect(await fs.saveDialog({})).toBe("/tmp/x");
    resetFs();
  });
});

describe("lifecycle mock", () => {
  it("reports tauri flag", () => {
    setLc({ isTauri: () => true, onBeforeUnload: () => () => {} });
    expect(lifecycle.isTauri()).toBe(true);
    resetLc();
  });
});
