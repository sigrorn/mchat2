// ------------------------------------------------------------------
// Component: FlowEditor (#218, slice 6 of #212)
// Responsibility: Author the per-conversation flow + per-persona role
//                 lens. Reachable from a small "Edit conversation
//                 flow" link at the bottom of PersonaPanel. Carries
//                 an "experimental" badge.
// Collaborators: lib/persistence/flows, lib/personas/service,
//                lib/flows/derivation.
// ------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import type { Flow, FlowDraft, FlowDraftStep, Persona } from "@/lib/types";
import * as flowsRepo from "@/lib/persistence/flows";
import { updatePersona } from "@/lib/personas/service";
import { derivedFlowFromRunsAfter } from "@/lib/flows/derivation";
import { invalidateRepoQuery } from "@/lib/data/useRepoQuery";
import { OutlineButton, PrimaryButton, DangerButton } from "@/components/ui/Button";

interface FlowEditorProps {
  conversationId: string;
  personas: readonly Persona[];
  onClose: () => void;
}

export function FlowEditor({ conversationId, personas, onClose }: FlowEditorProps): JSX.Element {
  const [draft, setDraft] = useState<FlowDraft>({
    currentStepIndex: 0,
    loopStartIndex: 0,
    steps: [],
  });
  const [existingFlow, setExistingFlow] = useState<Flow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearRunsAfterOnSave, setClearRunsAfterOnSave] = useState(false);
  // Per-persona role lens drafts. Initialized from persona.roleLens
  // and replaced on save.
  const [lensDraft, setLensDraft] = useState<Record<string, Record<string, "user" | "assistant">>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const f = await flowsRepo.getFlow(conversationId);
      if (cancelled) return;
      setExistingFlow(f);
      if (f) {
        setDraft({
          currentStepIndex: f.currentStepIndex,
          loopStartIndex: f.loopStartIndex,
          steps: f.steps.map((s) => ({ kind: s.kind, personaIds: [...s.personaIds] })),
        });
      }
      const lens: Record<string, Record<string, "user" | "assistant">> = {};
      for (const p of personas) lens[p.id] = { ...p.roleLens };
      setLensDraft(lens);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, personas]);

  const hasRunsAfter = useMemo(
    () => personas.some((p) => p.runsAfter.length > 0),
    [personas],
  );
  const showImportButton = hasRunsAfter && !existingFlow;

  const onAddStep = (kind: "user" | "personas"): void => {
    setDraft((d) => ({ ...d, steps: [...d.steps, { kind, personaIds: [] }] }));
  };
  const onRemoveStep = (idx: number): void => {
    setDraft((d) => {
      const nextSteps = d.steps.filter((_, i) => i !== idx);
      // #220: keep loopStartIndex valid as steps shrink. If we
      // removed the loop-start step itself or anything before it,
      // shift back by one (clamped at 0). If the loop-start would
      // fall off the end, clamp to the new last index.
      const cur = d.loopStartIndex ?? 0;
      let next = cur;
      if (idx < cur) next = cur - 1;
      if (next >= nextSteps.length) next = Math.max(0, nextSteps.length - 1);
      return { ...d, steps: nextSteps, loopStartIndex: next };
    });
  };
  const onMoveStep = (idx: number, dir: -1 | 1): void => {
    setDraft((d) => {
      const next = [...d.steps];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return d;
      [next[idx]!, next[target]!] = [next[target]!, next[idx]!];
      // #220: if the moved step was the loop-start, follow it to its
      // new position. Same goes for swaps that displace the
      // loop-start step.
      const cur = d.loopStartIndex ?? 0;
      let nextLoop = cur;
      if (cur === idx) nextLoop = target;
      else if (cur === target) nextLoop = idx;
      return { ...d, steps: next, loopStartIndex: nextLoop };
    });
  };
  const onSetLoopStart = (idx: number): void => {
    setDraft((d) => ({ ...d, loopStartIndex: idx }));
  };
  const onToggleStepKind = (idx: number): void => {
    setDraft((d) => {
      const next = [...d.steps];
      const s = next[idx]!;
      next[idx] = {
        kind: s.kind === "user" ? "personas" : "user",
        personaIds: s.kind === "personas" ? [] : s.personaIds,
      };
      return { ...d, steps: next };
    });
  };
  const onTogglePersona = (idx: number, personaId: string): void => {
    setDraft((d) => {
      const next = [...d.steps];
      const s = next[idx]!;
      const ids = s.personaIds.includes(personaId)
        ? s.personaIds.filter((id) => id !== personaId)
        : [...s.personaIds, personaId];
      next[idx] = { ...s, personaIds: ids };
      return { ...d, steps: next };
    });
  };
  const onLensToggle = (personaId: string, speakerKey: string): void => {
    setLensDraft((m) => {
      const cur = m[personaId] ?? {};
      const next = { ...cur };
      if (next[speakerKey] === "user") delete next[speakerKey];
      else next[speakerKey] = "user";
      return { ...m, [personaId]: next };
    });
  };

  const onImportFromRules = (): void => {
    const derived = derivedFlowFromRunsAfter([...personas]);
    setDraft(derived);
  };

  const onSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      // #218: validation lives in flowsRepo.upsertFlow (rejects empty
      // 'personas' steps and consecutive 'user' steps). Surface the
      // error rather than swallowing it.
      await flowsRepo.upsertFlow(conversationId, draft);
      // #223: refresh subscribers (e.g. PersonaPanel's flow row).
      invalidateRepoQuery(["flow"]);
      // Per-persona lens updates.
      for (const p of personas) {
        const next = lensDraft[p.id] ?? {};
        // Only write if changed (avoid touching the row otherwise).
        const same =
          Object.keys(next).length === Object.keys(p.roleLens).length &&
          Object.entries(next).every(([k, v]) => p.roleLens[k] === v);
        if (!same) {
          await updatePersona({ id: p.id, roleLens: next });
        }
      }
      // Optional: clear runs_after on every persona that participates
      // in the flow (per the import flow's checkbox, default off).
      if (clearRunsAfterOnSave) {
        for (const p of personas) {
          if (p.runsAfter.length === 0) continue;
          await updatePersona({ id: p.id, runsAfter: [] });
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <div className="p-4 text-sm text-neutral-500">Loading flow…</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="m-4 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-900">
              Conversation flow
            </h2>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-800">
              experimental
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-900"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-auto p-4">
          {showImportButton ? (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-900">
                This conversation has <code>runs_after</code> rules. Import
                them as a starting flow?
              </p>
              <OutlineButton onClick={onImportFromRules} className="mt-2">
                Import from runs_after rules
              </OutlineButton>
            </div>
          ) : null}

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase text-neutral-700">
              Steps ({draft.steps.length})
            </h3>
            <p className="mb-3 text-xs text-neutral-700">
              The conversation runs through these steps in order; at the
              end it loops back to the step marked <strong>↻ loop
              start</strong>. <strong>User</strong> steps wait for the
              human to send a message; <strong>personas</strong> steps
              dispatch to the listed personas in parallel before
              advancing. Steps before the loop start run only on the
              first cycle — useful for one-shot setup like a system
              briefing.
            </p>
            <ol className="space-y-2">
              {draft.steps.map((step, idx) => (
                <StepRow
                  key={idx}
                  index={idx}
                  step={step}
                  personas={personas}
                  isCursor={idx === draft.currentStepIndex}
                  isLoopStart={idx === (draft.loopStartIndex ?? 0)}
                  onToggleKind={() => onToggleStepKind(idx)}
                  onTogglePersona={(pid) => onTogglePersona(idx, pid)}
                  onMoveUp={() => onMoveStep(idx, -1)}
                  onMoveDown={() => onMoveStep(idx, 1)}
                  onRemove={() => onRemoveStep(idx)}
                  onSetLoopStart={() => onSetLoopStart(idx)}
                />
              ))}
            </ol>
            <div className="mt-2 flex gap-2">
              <OutlineButton onClick={() => onAddStep("user")}>
                + user step
              </OutlineButton>
              <OutlineButton onClick={() => onAddStep("personas")}>
                + personas step
              </OutlineButton>
            </div>
          </section>

          <section className="mt-6">
            <h3 className="mb-1 text-xs font-semibold uppercase text-neutral-700">
              Role lens — per persona
            </h3>
            <p className="mb-3 text-xs text-neutral-700">
              By default, a persona sees the human as <em>user</em> and
              every other persona as <em>assistant</em> (prefixed with
              the speaker's name). Tick a box below to flip a specific
              speaker to the <em>user</em> role for this persona's
              context — useful when, e.g., a coach persona should treat
              another persona's reply as input to react to.
            </p>
            <div className="space-y-3">
              {personas.map((p) => (
                <LensRow
                  key={p.id}
                  persona={p}
                  others={personas.filter((o) => o.id !== p.id)}
                  draft={lensDraft[p.id] ?? {}}
                  onToggle={(speakerKey) => onLensToggle(p.id, speakerKey)}
                />
              ))}
            </div>
          </section>

          {showImportButton ? (
            <div className="mt-4 flex items-center gap-2 text-xs text-neutral-800">
              <input
                type="checkbox"
                checked={clearRunsAfterOnSave}
                onChange={(e) => setClearRunsAfterOnSave(e.target.checked)}
                id="clearRunsAfter"
              />
              <label htmlFor="clearRunsAfter">
                Also clear <code>runs_after</code> rules on save (the flow
                replaces them for this conversation)
              </label>
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t border-neutral-200 px-4 py-3">
          <DangerButton
            onClick={async () => {
              if (!existingFlow) {
                onClose();
                return;
              }
              await flowsRepo.deleteFlow(conversationId);
              invalidateRepoQuery(["flow"]);
              onClose();
            }}
            disabled={!existingFlow || saving}
          >
            Delete flow
          </DangerButton>
          <div className="flex gap-2">
            <OutlineButton onClick={onClose} disabled={saving}>
              Cancel
            </OutlineButton>
            <PrimaryButton onClick={() => void onSave()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </PrimaryButton>
          </div>
        </footer>
      </div>
    </div>
  );
}

interface StepRowProps {
  index: number;
  step: FlowDraftStep;
  personas: readonly Persona[];
  isCursor: boolean;
  isLoopStart: boolean;
  onToggleKind: () => void;
  onTogglePersona: (id: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onSetLoopStart: () => void;
}

function StepRow(props: StepRowProps): JSX.Element {
  const { step, personas, isCursor, isLoopStart } = props;
  // Combine highlights when the cursor is sitting on the loop-start.
  const borderClass = isLoopStart
    ? "border-amber-400 bg-amber-50"
    : isCursor
      ? "border-blue-300 bg-blue-50"
      : "border-neutral-200 bg-white";
  return (
    <li className={`rounded border ${borderClass} p-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-700">#{props.index}</span>
          <button
            onClick={props.onToggleKind}
            className="rounded border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-900 hover:bg-neutral-200"
            title="Click to switch between 'user' and 'personas'"
          >
            {step.kind === "user" ? "user" : "personas"}
          </button>
          {isCursor ? (
            <span className="text-[10px] uppercase text-blue-600">cursor</span>
          ) : null}
          {isLoopStart ? (
            <span className="text-[10px] font-medium uppercase text-amber-700">
              ↻ loop start
            </span>
          ) : (
            <button
              onClick={props.onSetLoopStart}
              className="text-[10px] uppercase text-neutral-500 hover:text-amber-700"
              title="The cycle wraps back to this step at end of flow. Steps before this one run once as setup."
            >
              ↻ set as loop start
            </button>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={props.onMoveUp}
            className="text-xs text-neutral-600 hover:text-neutral-900"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            onClick={props.onMoveDown}
            className="text-xs text-neutral-600 hover:text-neutral-900"
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            onClick={props.onRemove}
            className="text-xs text-red-600 hover:text-red-800"
            aria-label="Remove step"
          >
            ✕
          </button>
        </div>
      </div>
      {step.kind === "personas" ? (
        <>
          <div className="mt-2 text-[11px] text-neutral-700">
            Personas that reply at this step (parallel — all run before
            the flow advances):
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {personas.map((p) => {
              const checked = step.personaIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs text-neutral-900 ${
                    checked
                      ? "border-blue-400 bg-blue-50"
                      : "border-neutral-300 bg-white"
                  }`}
                >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => props.onTogglePersona(p.id)}
                />
                  {p.name}
                </label>
              );
            })}
            {personas.length === 0 ? (
              <span className="text-xs text-neutral-700">
                (no personas — add some in the panel first)
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-2 text-[11px] text-neutral-700">
          Waits here until the human sends a message. The flow advances
          to the next step on send.
        </div>
      )}
    </li>
  );
}

interface LensRowProps {
  persona: Persona;
  others: readonly Persona[];
  draft: Record<string, "user" | "assistant">;
  onToggle: (speakerKey: string) => void;
}

function LensRow({ persona, others, draft, onToggle }: LensRowProps): JSX.Element {
  return (
    <div className="rounded border border-neutral-200 bg-white p-2">
      <div className="text-xs font-medium text-neutral-900">{persona.name}</div>
      <div className="mt-1 text-[11px] text-neutral-700">
        Treat these speakers as <em>user</em> (instead of the default
        <em> assistant</em>) when {persona.name} reads context:
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <label
          className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs text-neutral-900 ${
            draft.user === "user"
              ? "border-blue-400 bg-blue-50"
              : "border-neutral-300 bg-white"
          }`}
        >
          <input
            type="checkbox"
            checked={draft.user === "user"}
            onChange={() => onToggle("user")}
          />
          (human user)
        </label>
        {others.map((o) => (
          <label
            key={o.id}
            className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs text-neutral-900 ${
              draft[o.id] === "user"
                ? "border-blue-400 bg-blue-50"
                : "border-neutral-300 bg-white"
            }`}
          >
            <input
              type="checkbox"
              checked={draft[o.id] === "user"}
              onChange={() => onToggle(o.id)}
            />
            {o.name}
          </label>
        ))}
      </div>
    </div>
  );
}
