// ------------------------------------------------------------------
// Component: useConversationExports
// Responsibility: Bundle the four export entry points exposed by
//                 Sidebar's context menu — HTML, Markdown, snapshot
//                 take, snapshot import. Keeps Sidebar as a layout
//                 component rather than a multi-format export hub
//                 (#167). Each function takes a conversation id and
//                 surfaces the result as a notice on that conversation.
// Collaborators: Sidebar (sole consumer), conversations/exportToFile,
//                conversations/snapshotFileOps, snapshotImport.
// ------------------------------------------------------------------

import {
  exportConversationToHtml,
  exportConversationToMarkdown,
} from "@/lib/conversations/exportToFile";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useUiStore } from "@/stores/uiStore";
import type { Conversation, Message, Persona } from "@/lib/types";

interface ExportData {
  conversation: Conversation;
  messages: Message[];
  personas: Persona[];
  generatedAt: string;
}

async function getExportData(id: string): Promise<ExportData | null> {
  const all = await useConversationsStore.getState().listConversations();
  const conv = all.find((c) => c.id === id);
  if (!conv) return null;
  const [rawMessages, personas] = await Promise.all([
    useMessagesStore.getState().listMessages(id),
    usePersonasStore.getState().listPersonas(id, true),
  ]);
  // #294: //reset-hidden rows are dropped from the standard exports
  // (HTML, Markdown, snapshot). docs/ideas.md tracks a future "full
  // export" that would resurface them, color-coded by reset id.
  const messages = rawMessages.filter((m) => m.hiddenByResetId == null);
  return { conversation: conv, messages, personas, generatedAt: new Date().toISOString() };
}

export interface ConversationExports {
  exportHtml: (id: string) => Promise<void>;
  exportMarkdown: (id: string) => Promise<void>;
  takeSnapshot: (id: string) => Promise<void>;
  importSnapshot: () => Promise<void>;
}

export function useConversationExports(): ConversationExports {
  const exportHtml = async (id: string): Promise<void> => {
    const data = await getExportData(id);
    if (!data) return;
    const r = await exportConversationToHtml({
      ...data,
      workingDir: useUiStore.getState().workingDir,
    });
    if (r.ok) await useMessagesStore.getState().appendNotice(id, `exported to ${r.path}.`);
  };

  const exportMarkdown = async (id: string): Promise<void> => {
    const data = await getExportData(id);
    if (!data) return;
    const r = await exportConversationToMarkdown({
      ...data,
      workingDir: useUiStore.getState().workingDir,
    });
    if (r.ok) await useMessagesStore.getState().appendNotice(id, `exported to ${r.path}.`);
  };

  const takeSnapshot = async (id: string): Promise<void> => {
    const data = await getExportData(id);
    if (!data) return;
    const { exportSnapshot } = await import("@/lib/conversations/snapshotFileOps");
    const r = await exportSnapshot(
      data.conversation,
      data.personas,
      data.messages,
      useUiStore.getState().workingDir,
    );
    if (r.ok) await useMessagesStore.getState().appendNotice(id, `snapshot saved to ${r.path}.`);
  };

  const importSnapshot = async (): Promise<void> => {
    const { importSnapshotFile } = await import("@/lib/conversations/snapshotFileOps");
    const { importSnapshot: doImport } = await import("@/lib/conversations/snapshotImport");
    const file = await importSnapshotFile();
    if (!file.ok) return;
    const result = await doImport(file.snapshot);
    await useConversationsStore.getState().load();
    useConversationsStore.getState().select(result.conversation.id);
    await usePersonasStore.getState().load(result.conversation.id);
    await useMessagesStore.getState().load(result.conversation.id);
    if (result.missingKeys.length > 0) {
      await useMessagesStore
        .getState()
        .appendNotice(
          result.conversation.id,
          `imported. Missing API keys for: ${result.missingKeys.join(", ")}. Edit these personas to assign a valid provider before sending.`,
        );
    } else {
      await useMessagesStore
        .getState()
        .appendNotice(result.conversation.id, "snapshot imported successfully.");
    }
  };

  return { exportHtml, exportMarkdown, takeSnapshot, importSnapshot };
}
