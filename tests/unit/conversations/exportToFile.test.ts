// Orchestrator: load → export → saveDialog → writeText — issue #17.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exportConversationToHtml } from "@/lib/conversations/exportToFile";
import { __setImpl as setFs, __resetImpl as resetFs } from "@/lib/tauri/filesystem";
import { __setImpl as setKc, __resetImpl as resetKc } from "@/lib/tauri/keychain";
import type { Conversation, Message, Persona } from "@/lib/types";
import { makeMessage } from "@/lib/persistence/messages";

const CONV: Conversation = {
  id: "c_1",
  title: "Hello world",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "separated",
  visibilityMatrix: {},
  limitSizeTokens: null,
  selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
};

let writes: { path: string; content: string }[];
let saveReturn: string | null;
let knownKeys: Map<string, string>;

beforeEach(() => {
  writes = [];
  saveReturn = "/tmp/out.html";
  knownKeys = new Map([
    ["anthropic_api_key", "sk-ant-secretvalueXYZ"],
    ["openai_api_key", "sk-openaisecretXYZ"],
  ]);
  setFs({
    readText: async () => "",
    writeText: async (p, c) => {
      writes.push({ path: p, content: c });
    },
    appendText: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    exists: async () => true,
    mkdir: async () => {},
    copyFile: async () => {},
    removeFile: async () => {},
    saveDialog: async () => saveReturn,
    openDialog: async () => null,
  });
  setKc({
    get: async (k) => knownKeys.get(k) ?? null,
    set: async () => {},
    remove: async () => {},
    list: async () => [...knownKeys.keys()],
  });
});
afterEach(() => {
  resetFs();
  resetKc();
});

const messages: Message[] = [
  makeMessage({
    conversationId: "c_1",
    role: "user",
    content: "leak: sk-ant-secretvalueXYZ",
    index: 0,
  }),
];
const personas: Persona[] = [];

describe("exportConversationToHtml", () => {
  it("calls saveDialog, writes redacted HTML to the chosen path", async () => {
    const r = await exportConversationToHtml({
      conversation: CONV,
      messages,
      personas,
      generatedAt: "2026-04-15T00:00:00.000Z",
      workingDir: null,
    });
    expect(r.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/tmp/out.html");
    expect(writes[0]?.content).toContain("[REDACTED]");
    expect(writes[0]?.content).not.toContain("sk-ant-secretvalueXYZ");
    expect(writes[0]?.content).toContain("<title>Hello world</title>");
  });

  it("does not write when the user cancels the save dialog", async () => {
    saveReturn = null;
    const r = await exportConversationToHtml({
      conversation: CONV,
      messages,
      personas,
      generatedAt: "2026-04-15T00:00:00.000Z",
      workingDir: null,
    });
    expect(r.ok).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("supplies all known keychain values as knownSecrets to the redactor", async () => {
    knownKeys.set("openai_api_key", "sk-openaisecretXYZ");
    const localMessages: Message[] = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "two leaks: sk-ant-secretvalueXYZ and sk-openaisecretXYZ",
        index: 0,
      }),
    ];
    await exportConversationToHtml({
      conversation: CONV,
      messages: localMessages,
      personas,
      generatedAt: "2026-04-15T00:00:00.000Z",
      workingDir: null,
    });
    expect(writes[0]?.content).not.toContain("sk-ant-secretvalueXYZ");
    expect(writes[0]?.content).not.toContain("sk-openaisecretXYZ");
  });
});
