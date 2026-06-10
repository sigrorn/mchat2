// ------------------------------------------------------------------
// Component: PersonaPanel
// Responsibility: Collapsed/expanded root for the persona panel. When
//                 expanded it delegates to PersonaPanelExpanded; the
//                 list/create/edit/reorder surfaces were split into
//                 src/components/persona/ in #319.
// Collaborators: persona/PersonaPanelExpanded, uiStore (collapse +
//                font-scale counter-zoom).
// ------------------------------------------------------------------

import type { Conversation } from "@/lib/types";
import { useUiStore } from "@/stores/uiStore";
import { PersonaPanelExpanded } from "./persona/PersonaPanelExpanded";

export function PersonaPanel({
  conversation,
  navPersonaId = null,
  onSelectNavPersona,
}: {
  conversation: Conversation;
  // #137 nav-scope: which persona the chat-header arrows are scoped
  // to. Independent of the send-target checkboxes.
  navPersonaId?: string | null;
  onSelectNavPersona?: (id: string) => void;
}): JSX.Element {
  const collapsed = useUiStore((s) => s.personaPanelCollapsed);
  const toggleCollapse = useUiStore((s) => s.togglePersonaPanel);
  const fontScale = useUiStore((s) => s.chatFontScale);
  // #135: html root is scaled for chat/sidebar/composer zoom. Counter-
  // scale the persona panel via CSS zoom so it stays at baseline size
  // — otherwise it gets too cramped at 150%+.
  const counterScaleStyle: React.CSSProperties =
    fontScale === 1 ? {} : { zoom: 1 / fontScale };
  if (collapsed) {
    return (
      <aside
        style={counterScaleStyle}
        className="flex w-5 flex-col items-center border-l border-neutral-200 bg-neutral-50"
      >
        <button
          onClick={toggleCollapse}
          title="Expand personas panel"
          aria-label="Expand personas panel"
          className="mt-2 text-sm text-neutral-500 hover:text-neutral-900"
        >
          ‹
        </button>
      </aside>
    );
  }
  return (
    <PersonaPanelExpanded
      conversation={conversation}
      onCollapse={toggleCollapse}
      counterScaleStyle={counterScaleStyle}
      navPersonaId={navPersonaId}
      onSelectNavPersona={onSelectNavPersona}
    />
  );
}
