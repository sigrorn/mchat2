// ------------------------------------------------------------------
// Component: FlowModeRow
// Responsibility: Dedicated row for the conversation flow's
//                 "auto-managed selection" toggle (#223). Shown only
//                 when a flow is attached; ticked when flowMode is on.
//                 The label hints at the upcoming personas-step so the
//                 user can see where the next implicit follow-up lands.
// Collaborators: PersonaPanelExpanded (parent), app/flowSelectionSync.
// Extracted from PersonaPanel.tsx in #319.
// ------------------------------------------------------------------

import type { Flow, Persona } from "@/lib/types";
import { nextPersonasStepPersonaIds } from "@/lib/app/flowSelectionSync";

export function FlowModeRow({
  flow,
  personas,
  flowMode,
  onToggle,
}: {
  flow: Flow;
  personas: readonly Persona[];
  flowMode: boolean;
  onToggle: () => void;
}): JSX.Element {
  const nextIds = nextPersonasStepPersonaIds(flow) ?? [];
  const personaById = new Map(personas.map((p) => [p.id, p] as const));
  const nextNames =
    nextIds.length === 0
      ? "(no personas-step in this cycle)"
      : nextIds.map((id) => personaById.get(id)?.name ?? id).join(", ");
  return (
    <div
      className={`flex items-start gap-2 border-b border-neutral-200 px-3 py-2 ${
        flowMode ? "bg-amber-50" : "bg-white"
      }`}
    >
      <input
        type="checkbox"
        checked={flowMode}
        onChange={onToggle}
        className="mt-1"
        aria-label="Conversation flow auto-selection"
        title={
          flowMode
            ? "Flow is driving the persona selection. Tick a persona below to take manual control."
            : "Tick to follow the conversation flow — selection auto-syncs to the next step."
        }
      />
      <div className="flex-1 text-xs">
        <div className="font-medium text-neutral-900">↻ Conversation flow</div>
        <div className="text-neutral-700">→ {nextNames}</div>
      </div>
    </div>
  );
}
