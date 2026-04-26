# If I were to start mchat2 over

A retrospective written 2026-04-26 after shipping the openai_compat
provider work (#140 → #169/#170/#171) at v1.71.1. Not a complete
rewrite plan — the project at this maturity isn't worth restarting —
but a record of where the early architectural choices either paid off
or accumulated debt, so the next greenfield project starts from a
better baseline.

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
- **Zustand.** Light, no ceremony, fits the scale.

## What I'd reconsider on the tech stack

- **React → maybe Solid or Svelte 5.** React's re-render model caused
  real grief: memoizing `MessageBubble` and adding `@tanstack/react-virtual`
  to keep streaming smooth (#128), wrestling `useScrollPin` /
  tail-follow timing through three follow-ups in #137, the
  autoFocus + aria-label invisible-rendering bug in #139 that broke
  layout E2E. Fine-grained reactivity (signals) would simplify
  streaming-token patching to one line and remove most of the
  memoization+virtualization gymnastics. Counter-argument: the
  React ecosystem (react-markdown, react-virtual, react-virtual)
  was already there and battle-tested. **Lesson if starting fresh**:
  prototype in Solid first; fall back to React only if a
  critical lib turns out to be missing.
- **Tailwind.** Fine for solo work, but the inline-class soup made
  the bigger components hard to read and review — exactly the
  trigger for #139 (PersonaPanel 855 lines) and #167 (MessageList
  537, Sidebar 372). CSS modules or Vanilla Extract would scale
  better past ~400 lines per component, which is the threshold at
  which both files needed splitting.

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
3. **Use-case layer + ESLint boundaries from the first commit.**
   #142/#144/#168 covered: extracting `lib/app/` use cases, banning
   `@/stores/*` from `lib/**`, then dep-inverting keychain / settings /
   adapters / RAF / repo writes. The pattern works; arriving at it
   late meant the cleanup spanned ~10 sub-issues. Two hours of
   skeleton + lint config upfront would have prevented that.
4. **Schema discipline: JSON columns vs. proper columns.** Today
   we have `visibility_matrix`, `autocompact_threshold`,
   `selected_personas`, `context_warnings_fired`,
   `openai_compat_preset` all as JSON-encoded TEXT. Some genuinely
   need it (variable-shape config). Others are flat arrays that
   could be junction tables with proper indexing. Pick the line
   deliberately at design time, don't drift.
5. **ADRs in `docs/decisions/` from day one.** A single
   DECISIONS.md exists but isn't consistently used. Issues #137,
   #140, #163, #166, #168 each contained real tradeoff discussions
   worth preserving as ~200-word ADR pages. The cost is trivial;
   the value compounds when you (or a future contributor) ask
   "why did we do it this way?" three months later.
6. **Component-level tests early.** Test coverage is currently
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

Same Tauri + TypeScript + SQLite skeleton. Swap React for Solid or
Svelte 5 to make streaming UI work less gymnastically. Bake in
DAG-personas, openai_compat-meta-provider, and dep-inverted `lib/app`
from migration 1. Adopt ADRs, MCP support, structured logging from
day one. Everything else: keep.
