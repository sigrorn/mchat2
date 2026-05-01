// ------------------------------------------------------------------
// Component: Help text
// Responsibility: Return the full //help output listing all commands
//                 as markdown tables for column alignment. The body
//                 is generated from the COMMAND_SPECS registry so
//                 //help, autocomplete, and the parser cannot drift
//                 (#237).
// Collaborators: lib/commands/specs (registry), lib/commands/triggerHelp,
//                components/Composer.tsx.
// ------------------------------------------------------------------

import { COMMAND_SPECS, type CommandSection, type CommandSpec } from "./specs";

const SECTION_ORDER: Array<{ key: CommandSection; title: string }> = [
  { key: "context", title: "Context & limits" },
  { key: "pins", title: "Pins" },
  { key: "editing", title: "Editing" },
  { key: "display", title: "Display" },
  { key: "selection", title: "Selection" },
  { key: "info", title: "Info" },
  { key: "maintenance", title: "Maintenance" },
];

function specsForSection(section: CommandSection): CommandSpec[] {
  return COMMAND_SPECS.filter((s) => s.section === section);
}

function renderSection(title: string, specs: readonly CommandSpec[]): string {
  if (specs.length === 0) return "";
  const rows = specs.flatMap((s) =>
    s.usages.map((u) => `| \`${u.form}\` | ${u.description} |`),
  );
  return `## ${title}\n\n| Command | Description |\n|---|---|\n${rows.join("\n")}`;
}

const MESSAGE_TARGETING = `## Message targeting

| Form | Description |
|---|---|
| \`@name message\` | Send to a specific persona |
| \`@all message\` | Send to all personas |
| \`@others message\` | Send to non-selected personas |
| _(no prefix)_ | Send to currently selected personas |
| \`+name\` | Add persona to current selection |
| \`-name\` | Remove persona from current selection |`;

const KEYBOARD_SHORTCUTS = `## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| \`Ctrl+F\` | Find in chat |
| \`Ctrl+/-/0\` | Zoom in/out/reset |
| \`Enter\` | Send message |
| \`Shift+Enter\` | New line |`;

export function formatHelp(): string {
  const body = SECTION_ORDER.map(({ key, title }) =>
    renderSection(title, specsForSection(key)),
  )
    .filter((s) => s !== "")
    .join("\n\n");
  return [MESSAGE_TARGETING, body, KEYBOARD_SHORTCUTS].join("\n\n");
}
