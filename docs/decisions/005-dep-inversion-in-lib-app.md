# 005 — Dependency inversion in `lib/app`: keychain, settings, repos, RAF, adapters

Date: 2026-04-27 (retroactive — work landed in [#168](https://github.com/sigrorn/mchat2/issues/168))
Status: Accepted

## Decision

Extend the `*Deps` interfaces from [ADR 001](001-lib-app-boundary.md) to inject every external dependency `lib/app/` use cases reach for, not just store reads/writes. New deps:

- `getApiKey(provider): Promise<string | null>` — replaces direct `keychain.get` calls
- `getGlobalSystemPrompt() / getIdleTimeoutMs()` etc. — replaces direct `getSetting` calls
- `appendAssistantPlaceholder(args): Promise<Message>` — replaces `messagesRepo.appendMessage`
- `getAdapter(provider): ProviderAdapter` — replaces `adapterFor`
- `makeTraceSink(args): TraceSink | undefined` — replaces `makeTraceFileSink`
- `requestFrame(cb) / cancelFrame(id)` — replaces direct `requestAnimationFrame` calls

The `*Deps` factory in `src/hooks/runOneTargetDeps.ts` (and siblings) wires concrete implementations from `lib/tauri/*`, `lib/persistence/*`, `lib/providers/*` into the interface. Use-case bodies under `lib/app/*` now contain *no* direct infrastructure imports.

## Alternatives considered

- **Stop at the boundary already enforced by [ADR 001](001-lib-app-boundary.md).** Codex initially ranked this work *Critical* but downgraded after refinement: the boundary already prevents the worst regressions, and direct concrete imports for stable deps (keychain, repos) are not a per-PR maintenance burden. *Not chosen as the stopping point* because it leaves `lib/app/*` untestable against fakes — every test would need a real keychain and real DB.
- **Module-level mocks** (`vi.mock("@/lib/tauri/keychain")`). *Not chosen* — it works, but every test sets up its own mock surface, the wiring drifts, and the dep contract is implicit. The interface form documents what the use case actually needs.

## Tradeoff

Cost: more interface surface in `*Deps.ts` and a longer factory body in `*Deps` factories. Benefit: every use case under `lib/app/` is now unit-testable with a hand-rolled fake `*Deps` object — exercised heavily by the orchestration tests added during the data-layer refactors ([ADR 006](006-data-layer.md)). The boundary now matches the contract documented in the interface, with no hidden import-side effects.

When this becomes valuable to revisit: when a new piece of infrastructure (e.g. a notification system, a telemetry sink) starts reaching into `lib/app/*` directly. The pattern says: add to the relevant `*Deps`, not import in place.
