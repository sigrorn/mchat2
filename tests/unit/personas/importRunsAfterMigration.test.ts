// Phase 0 / Trigger B of #241: persona-import path auto-derives a flow
// from runs_after when the destination conversation has no flow attached,
// and appends a re-export notice on the conversation.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __setImpl as __setFsImpl,
  __resetImpl as __resetFsImpl,
} from "@/lib/tauri/filesystem";
import { importPersonasFromFile } from "@/lib/personas/fileOps";
import * as messagesRepo from "@/lib/persistence/messages";
import * as personasRepo from "@/lib/persistence/personas";
import * as flowsRepo from "@/lib/persistence/flows";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;

function installFs(payload: object): void {
  __setFsImpl({
    async readText() {
      return JSON.stringify(payload);
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
}

beforeEach(async () => {
  handle = await createTestDb();
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 0, 'lines', 'separated', '{}', '[]', '[]')`,
  );
});
afterEach(() => {
  handle?.restore();
  handle = null;
  __resetFsImpl();
});

describe("importPersonasFromFile auto-converts runs_after (#241 Trigger B)", () => {
  it("derives a flow + clears runsAfter + appends a re-export notice", async () => {
    installFs({
      version: 1,
      personas: [
        { name: "Alice", provider: "mock", runsAfter: [] },
        { name: "Bob", provider: "mock", runsAfter: ["Alice"] },
      ],
    });

    const r = await importPersonasFromFile("c_1", 0, null);
    if (!r.ok) throw new Error("import failed");

    const ps = await personasRepo.listPersonas("c_1");
    const bob = ps.find((p) => p.name === "Bob")!;
    expect(bob.runsAfter).toEqual([]);

    const flow = await flowsRepo.getFlow("c_1");
    expect(flow).not.toBeNull();
    const personaSteps = flow!.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(2);

    const msgs = await messagesRepo.listMessages("c_1");
    const conversionNotices = msgs.filter(
      (m) => m.role === "notice" && /re-export/i.test(m.content),
    );
    expect(conversionNotices).toHaveLength(1);
  });

  it("does not append a notice when imported personas have no runs_after", async () => {
    installFs({
      version: 1,
      personas: [
        { name: "Solo", provider: "mock", runsAfter: [] },
      ],
    });

    const r = await importPersonasFromFile("c_1", 0, null);
    if (!r.ok) throw new Error("import failed");

    const flow = await flowsRepo.getFlow("c_1");
    expect(flow).toBeNull();

    const msgs = await messagesRepo.listMessages("c_1");
    const conversionNotices = msgs.filter(
      (m) => m.role === "notice" && /re-export/i.test(m.content),
    );
    expect(conversionNotices).toHaveLength(0);
  });
});
