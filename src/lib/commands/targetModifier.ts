// ------------------------------------------------------------------
// Component: Target modifier parser
// Responsibility: Recognize +name / -name shortcuts that modify the
//                 current persona selection without sending a message.
// Collaborators: components/Composer.tsx.
// ------------------------------------------------------------------

export interface TargetOp {
  action: "add" | "remove";
  name: string;
}

export type TargetModifierResult =
  | { ok: true; ops: TargetOp[] }
  | { ok: false };

export function parseTargetModifiers(raw: string): TargetModifierResult {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("@")) {
    return { ok: false };
  }

  const tokens = trimmed.split(/\s+/);
  const ops: TargetOp[] = [];
  for (const token of tokens) {
    if (token.startsWith("+") && token.length > 1) {
      ops.push({ action: "add", name: token.slice(1).toLowerCase() });
    } else if (token.startsWith("-") && token.length > 1) {
      ops.push({ action: "remove", name: token.slice(1).toLowerCase() });
    } else {
      return { ok: false };
    }
  }
  if (ops.length === 0) return { ok: false };
  return { ok: true, ops };
}
