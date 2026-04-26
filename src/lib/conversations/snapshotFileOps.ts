// ------------------------------------------------------------------
// Component: Snapshot file operations
// Responsibility: Glue between snapshot serialization, compression,
//                 and the Tauri fs/dialog plugins.
// Collaborators: snapshot.ts, tauri/filesystem.ts, UI.
// ------------------------------------------------------------------

import { fs } from "../tauri/filesystem";
import { serializeSnapshot, compressSnapshot, decompressSnapshot, parseSnapshot } from "./snapshot";
import type { Conversation, Message, Persona } from "../types";
import type { SnapshotEnvelope } from "./snapshot";

function prefixWorkingDir(filename: string, workingDir: string | null): string {
  return workingDir ? `${workingDir}/${filename}` : filename;
}

function snapshotFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "chat"}-snapshot.mchat.json.gz`;
}

export type SnapshotExportOutcome =
  | { ok: true; path: string }
  | { ok: false; reason: "cancelled" };

export async function exportSnapshot(
  conversation: Conversation,
  personas: readonly Persona[],
  messages: readonly Message[],
  workingDir: string | null,
): Promise<SnapshotExportOutcome> {
  const json = serializeSnapshot(conversation, personas, messages);
  const compressed = await compressSnapshot(json);
  const defaultPath = prefixWorkingDir(snapshotFilename(conversation.title), workingDir);
  const chosen = await fs.saveDialog({
    defaultPath,
    filters: [{ name: "mchat snapshot", extensions: ["mchat.json.gz"] }],
  });
  if (!chosen) return { ok: false, reason: "cancelled" };
  await fs.writeBinary(chosen, compressed);
  return { ok: true, path: chosen };
}

export type SnapshotImportOutcome =
  | { ok: true; snapshot: SnapshotEnvelope }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "error"; message: string };

export async function importSnapshotFile(): Promise<SnapshotImportOutcome> {
  const chosen = await fs.openDialog({
    filters: [{ name: "mchat snapshot", extensions: ["mchat.json.gz", "json.gz", "json"] }],
  });
  if (!chosen) return { ok: false, reason: "cancelled" };
  const isGz = chosen.endsWith(".gz");
  let json: string;
  if (isGz) {
    const data = await fs.readBinary(chosen);
    json = await decompressSnapshot(data);
  } else {
    json = await fs.readText(chosen);
  }
  const result = parseSnapshot(json);
  if (!result.ok) return { ok: false, reason: "error", message: result.error };
  return { ok: true, snapshot: result.snapshot };
}
