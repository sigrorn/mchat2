// ------------------------------------------------------------------
// Component: MatrixPanel
// Responsibility: Per-persona × per-persona visibility grid below
//                 the Composer when ≥2 personas exist (#52). Parity
//                 with old mchat's MatrixPanel. Row headers are
//                 observers; column headers are sources; checked =
//                 observer sees source's replies.
// Collaborators: stores/conversationsStore.setVisibilityMatrix.
// ------------------------------------------------------------------

import type { Conversation, Persona } from "@/lib/types";
import { usePersonasStore } from "@/stores/personasStore";
import { useConversationsStore } from "@/stores/conversationsStore";

const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);

export function MatrixPanel({ conversation }: { conversation: Conversation }): JSX.Element | null {
  const personas = usePersonasStore((s) => s.byConversation[conversation.id]) ?? EMPTY_PERSONAS;
  if (personas.length < 2) return null;

  const matrix = conversation.visibilityMatrix;

  const isChecked = (observer: string, source: string): boolean => {
    if (observer === source) return true;
    const row = matrix[observer];
    if (row === undefined) return true; // not in matrix → full visibility
    return row.includes(source);
  };

  const toggle = (observer: string, source: string): void => {
    const row = matrix[observer] ?? personas.filter((p) => p.id !== observer).map((p) => p.id);
    const next = row.includes(source)
      ? row.filter((id) => id !== source)
      : [...row, source];
    const updated = { ...matrix, [observer]: next };
    void useConversationsStore.getState().setVisibilityMatrix(conversation.id, updated);
  };

  const short = (name: string): string => name.slice(0, 3).toLowerCase();

  return (
    <div className="border-l border-neutral-200 bg-neutral-50 px-3 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-700">
        Visibility (row sees column)
      </div>
      <table className="text-[10px]">
        <thead>
          <tr>
            <th />
            {personas.map((p) => (
              <th key={p.id} className="px-1 text-center font-normal text-neutral-800">
                {short(p.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {personas.map((observer) => (
            <tr key={observer.id}>
              <td className="pr-1 text-right text-neutral-800">{short(observer.name)}</td>
              {personas.map((source) => (
                <td key={source.id} className="px-1 text-center">
                  <input
                    type="checkbox"
                    checked={isChecked(observer.id, source.id)}
                    disabled={observer.id === source.id}
                    onChange={() => toggle(observer.id, source.id)}
                    className="h-3 w-3"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
