# If I were to start mchat2 over

A retrospective written 2026-04-26 after shipping the openai_compat
provider work (#140 → #169/#170/#171) at v1.71.1, refined the same
day after a parallel review by Codex of the same question. Not a
complete rewrite plan — the project at this maturity isn't worth
restarting — but a record of where the early architectural choices
either paid off or accumulated debt, so the next greenfield project
starts from a better baseline.

The headline learning, after both my and Codex's review converged:
**get the domain shape right and most tech-stack alternatives stop
mattering**. Run/Attempt as a state machine, clean persistent-vs-UI
state separation, typed-SQL with schemas at the boundary, dep
inversion from day one — once those primitives are in place, the
choice between React and Solid is a 10 % issue rather than a 30 %
issue.

## What the current stack got right

- **Tauri** over Electron. Small bundle, native keychain, tighter
  security model. The webview quirks (Windows flag emoji rendering,
  the autoFocus / aria-label dance in #139) are inherent to any
  "browser-on-desktop" stack — switching to Electron just trades
  smaller pain for a fatter binary.
- **TypeScript.** Non-negotiable for this domain.
- **SQLite via @tauri-apps/plugin-sql.** Perfect fit for local-first
  single-user. The decision in #157/#159 to back unit tests with
  sql.js running the production migration sequence is one of the
  highest-ROI calls in the project — schema drift between mock and
  prod is now impossible.
- **Vitest + Playwright + sql.js.** The test culture (test-first,
  paired commits, real-DB unit tests, focused E2E) caught real
  regressions repeatedly — most visibly the scroll-pin loop in #137
  and the persona-form aria-label regression in #139.
- **Zustand.** Light, no ceremony, fits the scale **for UI state**.
  See architecture point 5 for the conflation problem to avoid.

## What I'd reconsider on the tech stack

The honest answer: not much, once the architecture below is right.

- **Tailwind.** Fine for solo work, but the inline-class soup made
  the bigger components hard to read and review — exactly the
  trigger for #139 (PersonaPanel 855 lines) and #167 (MessageList
  537, Sidebar 372). CSS modules or Vanilla Extract would scale
  better past ~400 lines per component, which is the threshold at
  which both files needed splitting.
- **React → Solid or Svelte 5: noted but de-prioritized.** My first
  draft of this retrospective put the framework swap up high, citing
  the streaming-token + memoization + scroll-pin gymnastics. Codex
  pointed out — correctly — that those are *symptoms* of poor state
  separation (UI state and persistent-entity state coexisting in
  the same Zustand stores), not of React itself. With the
  architectural fixes below, React's re-render model stops being a
  bottleneck. **Lesson if starting fresh**: fix the state boundary
  first; the framework choice becomes secondary.

## Architecture — what I'd do differently from day one

1. **Persona DAG + visibility matrix as first-class.** These got
   bolted on across migrations (#52 visibility_matrix, #66
   multi-parent runsAfter, #94 visibilityDefaults). It's the
   project's distinctive feature; modeling "conversation = ordered
   set of personas with edges + matrix" in migration v1 would have
   slotted every later feature in cleaner. Six migrations exist
   today because this was retrofitted.

2. **"OpenAI-compatible endpoint + native shims" as the provider
   model from the start.** Today's structure (Claude / GPT / Gemini
   as native shims, openai_compat as a meta-provider with a preset
   table) is what we just reached. Starting there would have
   avoided the three-phase #140 refactor and the awkward transitional
   parallel of native `apertus` alongside Infomaniak-as-preset.
   Concretely: a generic provider spec — base URL, auth style,
   model list/defaults, streaming protocol, usage extraction,
   hosting metadata, extra headers, registration URL — with
   "real adapters" only where a provider genuinely diverges
   (Anthropic's non-OpenAI streaming format, Gemini's auth shape).

3. **Use-case layer + ESLint boundaries from the first commit.**
   #142/#144/#168 covered: extracting `lib/app/` use cases, banning
   `@/stores/*` from `lib/**`, then dep-inverting keychain / settings /
   adapters / RAF / repo writes. The pattern works; arriving at it
   late meant the cleanup spanned ~10 sub-issues. **Codex's framing**
   is sharper: think of `lib/app/` as a "headless core" package
   that React + Tauri only *adapt* into a UI. Two hours of skeleton
   + lint config upfront would have prevented the entire late-stage
   extraction.

4. **Send / retry / replay as an explicit run state machine.**
   *(Codex)* The app's true domain is not "messages" but
   "conversation runs across personas/providers with dependencies,
   partial streams, failures, retries, and replacement semantics."
   Today this concept is implicit and scattered across
   `orchestration/`, `useSend`, `runOneTarget`, `replayMessage`. A
   first-class `Run` containing `RunTarget`s with `Attempt`s and
   an explicit replacement policy would unify all of them. The
   diagnostic test: retry should automatically supersede the
   relevant assistant output, never relying on `//hide` or manual
   transcript surgery. Today it doesn't quite — that's the symptom
   of the missing primitive. **This was Codex's strongest insight
   and one I missed on my first pass.**

5. **Separate persistent app state from reactive UI state.**
   *(Codex)* Zustand is the right tool for UI state — selected
   conversation, active streams, transient editing state, panel
   open/closed, scroll/focus/session state. It is the wrong tool
   for persistent entities (conversations, messages, personas,
   settings, provider configs, costs), which today ride in the
   same stores and conflate cache, mutation, and orchestration.
   Routing persistent data through repository APIs (or
   TanStack-Query-shaped boundaries) and keeping Zustand strictly
   UI-only would make cache invalidation, reload semantics,
   transaction boundaries, and tests dramatically cleaner. **This
   is what made #144/#168 hard** — extracting use cases from
   stores was a symptom of mixing the two concerns from day one.

6. **Transactions / unit-of-work from the beginning.** Added late
   in #164. A foundational architecture would make the unsafe
   version hard to write: replay edit, //pop, //compact, snapshot
   import — every multi-step mutation should be one atomic
   operation by default, not by retrofit.

7. **Schema discipline: typed SQL + zod at the boundary.**
   *(Codex)* The hand-maintained `Row` interfaces in `personas.ts` /
   `messages.ts` / `conversations.ts` are a quiet drift source —
   they compile fine until production breaks. Kysely / Drizzle (or
   any typed-SQL layer) plus zod schemas at every persistence and
   import boundary would have made #165's zod work near-automatic
   and would have caught most JSON-column shape drift at compile
   time rather than at runtime.

8. **Schema decisions: JSON columns vs. proper columns.** Today
   we have `visibility_matrix`, `autocompact_threshold`,
   `selected_personas`, `context_warnings_fired`,
   `openai_compat_preset` all as JSON-encoded TEXT. Some genuinely
   need it (variable-shape config). Others are flat arrays that
   could be junction tables with proper indexing. Pick the line
   deliberately at design time, don't drift.

9. **ADRs in `docs/decisions/` from day one.** A single
   DECISIONS.md exists but isn't consistently used. Issues #137,
   #140, #163, #166, #168 each contained real tradeoff discussions
   worth preserving as ~200-word ADR pages. The cost is trivial;
   the value compounds when you (or a future contributor) ask
   "why did we do it this way?" three months later. Codex didn't
   emphasize this; it's process discipline that compounds
   independently of architecture and is worth applying anyway.

10. **Component-level tests early.** Test coverage is currently
    smoke-E2E only for UI. Adding `@testing-library/react`
    immediately after React was set up would have caught the
    layout regression in #139 at unit-test speed instead of E2E
    speed.

## Things I'd add new

- **MCP (Model Context Protocol) support.** Every adjacent open-source
  project (LibreChat, Open WebUI) has it. Tool-calling-per-persona
  is a natural fit for the DAG model.
- **Structured logging** routed through a TraceSink-shaped destination.
  We already have `makeTraceFileSink` for stream traces — generalize
  it to a single observability surface so debug traces, error logs,
  and stream events share one pipe.
- **Versioned snapshot format with explicit migrations.** Snapshots
  carry a `version: 1` tag today but no migration path. Even a
  trivial `migrateSnapshot(v→v+1)` chain would future-proof imports.

## Stack TL;DR

Same Tauri + TypeScript + SQLite skeleton. **Don't swap React** —
the framework pain disappears once UI state and persistent state
stop sharing the same Zustand stores. Bake in DAG-personas,
openai_compat-meta-provider, dep-inverted `lib/app` headless core,
explicit run/attempt state machine, transactions-by-default, and
typed SQL + zod at the boundary from migration 1. Adopt ADRs, MCP
support, structured logging from day one. The sharpest single
sentence in either review (Codex's): *the architecture should make
the unsafe version hard to write.*
