// ------------------------------------------------------------------
// Component: Copy with persona prefixes
// Responsibility: Format selected chat text with //user and
//                 //<persona> (<model>) prefixes before each speaker
//                 change, for Ctrl-C clipboard output.
// Collaborators: components/MessageList.tsx.
// ------------------------------------------------------------------

import type { Message, Persona } from "../types";

export function formatCopyText(messages: readonly Message[], personas: readonly Persona[]): string {
  const nameById = new Map(personas.map((p) => [p.id, p.name]));
  const lines: string[] = [];
  let lastSpeaker = "";

  for (const m of messages) {
    if (m.role === "notice" || m.role === "system") continue;
    if (!m.content) continue;

    let speaker: string;
    if (m.role === "user") {
      speaker = "//user";
    } else {
      const name = m.personaId ? (nameById.get(m.personaId) ?? m.personaId) : (m.provider ?? "assistant");
      const model = m.model ? ` (${shortenModel(m.model)})` : "";
      speaker = `//${name}${model}`;
    }

    if (speaker !== lastSpeaker) {
      if (lines.length > 0) lines.push("");
      lines.push(speaker);
      lastSpeaker = speaker;
    }
    lines.push(m.content);
  }

  return lines.join("\n");
}

function shortenModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/-\d{8}$/, "");
}
