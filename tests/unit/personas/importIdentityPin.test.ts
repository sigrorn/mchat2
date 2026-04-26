// Imported personas must get their identity pin — issue #36.
// #200: rewritten to round-trip through sql.js instead of asserting on
// INSERT INTO messages parameter positions.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl as __setFsImpl, __resetImpl as __resetFsImpl } from "@/lib/tauri/filesystem";
import { importPersonasFromFile } from "@/lib/personas/fileOps";
import * as messagesRepo from "@/lib/persistence/messages";
import * as personasRepo from "@/lib/persistence/personas";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
beforeEach(() => {
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
    async appendText() {},
    async readBinary() {
      return new Uint8Array();
    },
    async writeBinary() {},
    async exists() {
      return true;
    },
    async mkdir() {},
    async copyFile() {},
    async removeFile() {},
    async openDialog() {
      return "/tmp/personas.json";
    },
    async saveDialog() {
      return null;
    },
  });
});
afterEach(() => {
  handle?.restore();
  handle = null;
  __resetFsImpl();
});

describe("importPersonasFromFile identity pins (#36)", () => {
  it("appends both identity pins per imported persona (#38)", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 0, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    const r = await importPersonasFromFile("c_1", 0, null);
    if (!r.ok) throw new Error("import failed: " + ("message" in r ? r.message : r.reason));

    const personas = await personasRepo.listPersonas("c_1");
    expect(personas).toHaveLength(2);

    const allMessages = await messagesRepo.listMessages("c_1");
    const identityPins = allMessages.filter((m) => m.pinned && m.pinTarget);
    // 2 personas × 1 pin each (instruction only; setup is a notice) = 2
    expect(identityPins).toHaveLength(2);
    const notices = allMessages.filter((m) => m.role === "notice");
    expect(notices).toHaveLength(2);
    for (const persona of personas) {
      const own = identityPins.filter((p) => p.pinTarget === persona.id);
      expect(own).toHaveLength(1);
      const hasInstruction = own.some((p) => p.content.includes("use " + persona.name));
      const hasSetupNote = notices.some((p) =>
        p.content.startsWith(`Added persona "${persona.name}"`),
      );
      expect(hasInstruction).toBe(true);
      expect(hasSetupNote).toBe(true);
    }
  });
});
