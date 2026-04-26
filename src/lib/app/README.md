# `lib/app/` — application / use-case layer

Pure, deps-injected orchestration. Lives between the React UI and the
domain libraries (`lib/orchestration`, `lib/personas`, `lib/persistence`,
…). Use cases here are async functions that take a `*Deps` object and
return a result; **no Zustand stores, no React hooks, no `@tauri-apps/*`
imports**. The boundary is enforced by ESLint
([eslint.config.js](../../../eslint.config.js)).

## Why

Before this layer existed, send / retry / replay / post-response checks
all lived under `src/hooks/` and reached into Zustand stores via
`useXxxStore.getState()`. That made them React-coupled (despite being
mostly pure logic) and harder to test in isolation. Codex review
flagged the resulting drift; #144 tracks the migration.

## Pattern

```ts
// src/lib/app/sendMessage.ts
import type { SendMessageDeps } from "./deps";

export interface SendMessageArgs {
  conversation: Conversation;
  text: string;
  pinned?: boolean;
}

export async function sendMessage(
  deps: SendMessageDeps,
  args: SendMessageArgs,
): Promise<SendResult> {
  const personas = deps.getPersonas(args.conversation.id);
  const selection = deps.getSelection(args.conversation.id);
  // …orchestrate; never touch a store directly.
  await deps.appendUserMessage({ … });
  // …
}
```

The React hook layer (in `src/hooks/`) wires deps from stores at call
time:

```ts
// src/hooks/useSend.ts
import { sendMessage } from "@/lib/app/sendMessage";

export function useSend(conversation: Conversation) {
  const deps: SendMessageDeps = useMemo(() => ({
    getPersonas: (id) => usePersonasStore.getState().byConversation[id] ?? [],
    appendUserMessage: (args) => useMessagesStore.getState().sendUserMessage(args),
    // …
  }), []);
  const send = useCallback(
    (text: string, opts: SendOptions = {}) =>
      sendMessage(deps, { conversation, text, pinned: opts.pinned }),
    [conversation, deps],
  );
  return { send };
}
```

## Per-concern interfaces

[deps.ts](./deps.ts) defines small per-concern interfaces:

- `MessagesReadDeps` / `MessagesWriteDeps`
- `PersonasReadDeps` / `PersonasWriteDeps`
- `ConversationsWriteDeps`
- `SendStateDeps`
- `UiReadDeps`

Each use case composes only the slices it needs (`SendMessageDeps`,
`RunOneTargetDeps`, `RetryMessageDeps`, `PostResponseCheckDeps`, …).
This keeps test mocks small and makes the dependency graph honest —
a function that doesn't need to read personas shouldn't have a
`getPersonas` field on its deps.

## Adding a new use case

1. Define an args type (one object).
2. Compose a deps type from the per-concern interfaces in
   [deps.ts](./deps.ts) — extend the file if a new concern shows up
   that's reused across at least two use cases.
3. Write the function as `async (deps, args) => Result`.
4. In the calling React layer (`src/hooks/`), wire deps from stores
   and pass them in.
5. Write tests that pass a hand-rolled stub deps object — no stores,
   no React.

## What does **not** belong here

- React hooks (`useState`, `useEffect`, `useCallback`).
- Zustand store imports.
- Direct `@tauri-apps/*` imports — go through `src/lib/tauri/*`.
- DOM / browser APIs — wrap them in deps if a use case needs them.
