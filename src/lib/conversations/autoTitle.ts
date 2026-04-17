// ------------------------------------------------------------------
// Component: Auto-title generator
// Responsibility: After the first assistant reply, fire a hidden
//                 background request to the same provider/model and
//                 generate a short conversation title. Pure helpers +
//                 the streaming orchestrator so useSend stays thin.
// Collaborators: hooks/useSend (trigger), providers/adapter (stream).
// ------------------------------------------------------------------

import type { ProviderAdapter } from "../providers/adapter";

const MAX_TITLE_CHARS = 25;

const TITLE_SYSTEM_PROMPT =
  "Summarize the intent of this conversation in at most 25 characters. " +
  "Reply with ONLY the summary text — no quotes, no punctuation, no preamble, " +
  "no explanation. Just the topic.";

export function cleanTitle(raw: string): string {
  let t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1);
  }
  t = t.replace(/\.+$/, "").trim();
  if (t.length > MAX_TITLE_CHARS) t = t.slice(0, MAX_TITLE_CHARS);
  return t;
}

export async function generateTitle(
  adapter: ProviderAdapter,
  apiKey: string | null,
  model: string,
  userContent: string,
  assistantContent: string,
): Promise<string> {
  const streamId = `title:${Date.now()}`;
  let accumulated = "";
  try {
    for await (const e of adapter.stream({
      streamId,
      model,
      systemPrompt: TITLE_SYSTEM_PROMPT,
      apiKey,
      messages: [
        { role: "user", content: userContent },
        { role: "assistant", content: assistantContent },
        { role: "user", content: "Now summarize the topic." },
      ],
    })) {
      if (e.type === "token") accumulated += e.text;
      if (e.type === "error" || e.type === "cancelled") break;
    }
  } catch {
    // Silent discard — title generation failure is not user-facing.
  }
  return cleanTitle(accumulated);
}
