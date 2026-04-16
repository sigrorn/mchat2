// Imported personas must get their identity pin — issue #36.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import {
  __setImpl as __setFsImpl,
  __resetImpl as __resetFsImpl,
} from "@/lib/tauri/filesystem";
import { importPersonasFromFile } from "@/lib/personas/fileOps";

interface PersonaRow {
  id: string;
  name: string;
  name_slug: string;
}

function makeStubs() {
  const personas: PersonaRow[] = [];
  const messageInserts: Array<Record<string, unknown>> = [];
  __setImpl({
    async execute(query, params) {
      const ps = (params ?? []) as unknown[];
      if (query.startsWith("INSERT INTO personas")) {
        personas.push({
          id: String(ps[0]),
          name: String(ps[3]),
          name_slug: String(ps[4]),
        });
      }
      if (query.startsWith("INSERT INTO messages")) {
        // Column order from messages.ts appendMessage:
        // id, conversation_id, role, content, provider, model,
        // persona_id, display_mode, pinned, pin_target, addressed_to,
        // created_at, idx, error_message, error_transient,
        // input_tokens, output_tokens, usage_estimated, audience
        messageInserts.push({
          id: ps[0],
          role: ps[2],
          content: ps[3],
          pinned: ps[8],
          pin_target: ps[9],
        });
      }
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(query: string): Promise<T[]> {
      if (query.includes("FROM personas")) {
        return personas.map((p) => ({
          id: p.id,
          conversation_id: "c_1",
          provider: "claude",
          name: p.name,
          name_slug: p.name_slug,
          system_prompt_override: null,
          model_override: null,
          color_override: null,
          created_at_message_index: 0,
          sort_order: 0,
          runs_after: null,
          deleted_at: null,
          apertus_product_id: null,
        })) as unknown as T[];
      }
      if (query.includes("MAX(idx)")) {
        return [{ next: 0 } as unknown as T];
      }
      if (query.includes("FROM messages")) {
        return [];
      }
      return [];
    },
    async close() {},
  });
  __setFsImpl({
    async readText() {
      return JSON.stringify({
        version: 1,
        personas: [
          { name: "Alice", provider: "claude" },
          { name: "Bob", provider: "openai" },
        ],
      });
    },
    async writeText() {},
    async readBinary() {
      return new Uint8Array();
    },
    async writeBinary() {},
    async exists() {
      return true;
    },
    async openDialog() {
      return "/tmp/personas.json";
    },
    async saveDialog() {
      return null;
    },
  });
  return { messageInserts, personas };
}

beforeEach(() => makeStubs());
afterEach(() => {
  __resetImpl();
  __resetFsImpl();
});

describe("importPersonasFromFile identity pins (#36)", () => {
  it("appends an identity pin row per imported persona", async () => {
    const { messageInserts, personas } = makeStubs();
    const r = await importPersonasFromFile("c_1", 0);
    if (!r.ok) throw new Error("import failed: " + ("message" in r ? r.message : r.reason));
    expect(personas).toHaveLength(2);
    const identityPins = messageInserts.filter((m) => m.pinned === 1 && m.pin_target);
    expect(identityPins).toHaveLength(2);
    const targets = identityPins.map((m) => m.pin_target);
    expect(targets).toEqual(personas.map((p) => p.id));
    for (const pin of identityPins) {
      const persona = personas.find((p) => p.id === pin.pin_target);
      expect(pin.content).toContain(persona!.name);
    }
  });
});
