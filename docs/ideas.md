# Ideas

Ideas that came up in design discussions but were deferred or not pursued.
Kept here so future-us can revisit without having to re-derive the
context from scratch.

## `//undo` (or similar) to un-hide a confirmed notice

**Discussed:** 2026-04-30, while specifying the
[notice confirm-and-hide checkbox](#229) feature.

The shipped behaviour confirms a notice and hides it from view
(setting `confirmed_at` on the row). The DB row stays, so the
information isn't lost — but there's no UI to un-hide it. If the
user wants to re-surface a confirmed notice (e.g. they
mis-clicked, or want to reread an old //compact summary), they
have to dig into the SQLite file.

A future `//undo` command (or a per-conversation "show
confirmed notices" toggle in the UI) would re-display them.
Cheap to add — clear `confirmed_at` on the matching row(s).

**Why deferred:** the no-reversibility version covers the
primary use case (clutter reduction). Adding the un-hide path
is a separate UX decision (one-click reverse-most-recent? a
//undo command? a hidden-by-default panel?) that's worth
deferring until the bare confirm-and-hide is in use and the
need shape becomes clearer.

## Fork-with-full-trace (debugging variant)

**Discussed:** 2026-04-29, while specifying the [`//fork` command](#) for
branching a conversation.

The shipped `//fork` only copies message content (role, persona, body,
addressed_to, pinned/notices). The `Run` / `RunTarget` / `Attempt` rows
that back each assistant message — raw provider request/response, token
counts, retry history, what the debug inspector reads — stay on the
source conversation. Open the inspector on a forked assistant message
and you get "no trace recorded."

For the documented use case (slowly working toward a re-usable starting
point) that's fine — the user cares about the message content, not the
provenance of how it was produced.

A second variant would also clone the trace rows (with new ids,
repointed at the new conversation). This is the right shape for a
debugging workflow: "fork at this turn, try variations, compare what
each branch sent the model." Costs are real:

- `Attempt.raw_response` can be hundreds of KB per assistant turn
  (full streaming SSE body), so each fork roughly doubles storage for
  the duplicated range.
- More writes, more rows, more places where ids must be remapped.

**Why deferred:** Not what the user asked for. The fork command exists
to capture re-usable starting points; trace data is set dressing for
that use case. Worth picking up if a debugging-comparison workflow
comes up later — at that point the simplest extension is `//fork
--with-trace` (or a settings toggle), reusing the same plumbing and
adding a second pass that clones the run/runtarget/attempt rows.

## File attachments / provider file uploads

**Discussed:** 2026-05-01, while asking which currently supported
providers can upload a file and include it in model context.

The provider answer is not "all OpenAI-compatible APIs have files."
The current app shape is simpler than that: `ProviderAdapter` accepts
messages as `{ role, content: string }`, and the native/OpenAI-compatible
adapters send text-only chat payloads. So no provider file upload path is
wired in mchat2 today, even where the upstream provider supports it.

Provider capability snapshot:

- OpenAI: yes. Files API plus `file_id`, URL, and base64 file inputs.
- Claude / Anthropic: yes. Files API can upload files and reference
  them from Messages.
- Gemini: yes. Gemini Files API uploads media/documents and includes
  them in `generateContent` prompts.
- Mistral: yes, mainly via document/OCR/QnA paths. Supports uploaded
  files for OCR plus document QnA over URLs/base64/uploaded PDFs.
- Perplexity: yes, but inline rather than a persistent app-style file
  store. It supports `file_url` with public URLs or base64 for common
  document formats.
- OpenRouter: yes/partial. Supports PDF/file inputs via URL or base64
  in chat requests; behaviour is model/router dependent.
- OVHcloud AI Endpoints: partial. Supports some image inputs on the
  Responses API, but not a generic portable file-search/files layer.
- IONOS AI Model Hub: adjacent, not a generic chat file upload path.
  It has OCR/image/document collection features, but not a portable
  attachment API for the current OpenAI-compatible chat adapter.
- Apertus / Infomaniak: no generic Apertus file-context path found.
  Apertus is exposed here as text generation through Infomaniak's
  OpenAI-compatible chat endpoint.
- Mock: no.

The architectural shape should be an attachment abstraction, not a
provider flag bolted onto chat messages. The app would need to persist
local file metadata and message attachment links, then let each provider
adapter choose its send strategy:

- persistent provider upload with a `file_id` (OpenAI, Anthropic,
  some Mistral paths);
- inline base64 or URL file parts (Perplexity, OpenRouter, some OpenAI
  flows);
- Gemini's own file lifecycle, including expiration semantics;
- fallback local extraction to text for providers without file context.

The tricky parts are lifecycle and replay semantics. Attachments must
survive `//edit`, `//retry`, `//pop`, `@convo` replay, snapshot/fork,
and compaction in a way that is explicit about whether the original file
bytes, extracted text, provider upload id, or just a dangling reference
is being reused. Provider upload ids can expire or be provider/account
specific, so storing only a remote id is not enough.

**Why deferred:** Useful, but it is a cross-cutting feature rather than
a small provider toggle. It touches composer UI, persistence, context
building, provider adapters, exports/snapshots, replay/edit/pop
semantics, and privacy expectations around sending local files to
remote providers. Worth doing only after deciding the product-level
behaviour for "attach this file to this turn" versus "add this document
to reusable conversation context."

## Window-aware autocompact warning thresholds

**Discussed:** 2026-05-03, while landing
[per-model context windows (#261)](docs/decisions/) — Apertus's 16k
window made the existing 80/90/98% warning ladder visibly inadequate.

The shipped warning thresholds are `[80, 90, 98]` percent, calibrated
back when the tightest realistic window was Claude/OpenAI in the
~100k+ range. With per-model windows in place, Apertus 8B/70B at
16,384 tokens the same percentages translate to:

| Threshold | Apertus 16k headroom | Mistral 128k | Claude 200k |
|---|---|---|---|
| 80% | ~3.2k tokens | ~26k | ~40k |
| 90% | **~1.6k tokens** | ~13k | ~20k |
| 98% | ~300 tokens | ~2.5k | ~4k |

A typical user/assistant turn is 1–3k tokens combined (10k+ with
code). On Apertus, by the time the 90% warning fires there's room
for maybe one more turn before `truncateToFit` starts silently
dropping oldest messages. The 98% warning is below a single-message
threshold and effectively useless. Compaction itself sends pre-cutoff
history through the same model, so triggering compaction at 90%
on a tight window leaves little headroom for the summary call's
own input.

Three candidate fixes:

1. **Lower thresholds globally** (e.g. `[50, 75, 90]`). Simplest
   change, adds notice noise on big windows where the absolute
   headroom at 80% is already huge.
2. **Scale thresholds by window size** (e.g. window ≤ 32k →
   `[50, 70, 90]`, else `[80, 90, 98]`). Right tradeoff per window;
   small lookup, cheap to implement.
3. **Absolute-remainder warnings** (warn at "< 4k tokens free",
   "< 1.5k free", "< 500 free"). Maps directly to "how many turns
   can I still fit," which is the question the user is actually
   answering when they look at the warning. Same threshold means
   the same thing on every model. Would replace `WARNING_THRESHOLDS`
   in [autocompactCheck.ts](src/lib/commands/autocompactCheck.ts)
   with a tokens-free comparison and update `formatTriggeringPersonas`
   in [postResponseCheck.ts](src/lib/app/postResponseCheck.ts) to
   show "X has 1.2k free" instead of "X at 92%".

**Why deferred:** Worth living with the existing 80/90/98% on
Apertus first to see whether silent truncation actually bites in
practice — the user may compact manually well before the warnings
matter. If it does bite, option 3 (absolute remainder) is the
cleanest semantic fix; option 2 is the cheapest patch.

## Central prompts editor (`//editprompts`)

**Discussed:** 2026-05-04, while specifying the prompt viewer
(`//activeprompts`).

System prompts live in three places today: Settings · General
(global), conversation settings (`conversation.systemPrompt`), and
each persona's `systemPromptOverride` in the persona panel. Plus
flow-step-level `stepInstruction` for flow personas-steps (#230).
The composed system block at send time is built in
[builder.ts:113](src/lib/context/builder.ts#L113):

```
[identityLine, globalPrompt, persona.override ?? conversation.prompt,
 stepNote].filter(notNull).join("\n\n")
```

A central editor would render every layer in one dialog with a
textarea per source, letting the user see them in composition
order and edit them in one place.

**Risks / why this isn't trivial:**

1. **Three different write paths in one save action.** Edits go to
   `setSetting(GLOBAL_SYSTEM_PROMPT_KEY)`, `conversationsRepo.
   updateConversation`, and `personasRepo.update`. If one fails
   partway through, the user sees inconsistent state. Each is
   idempotent, so retry recovers, but the dialog needs explicit
   per-row save status.

2. **Global prompt is world-affecting.** Changing it touches every
   conversation and every persona in every conversation, retroactively
   for future turns. Needs the loudest warning of the four layers —
   either a confirm modal, a two-step "unlock" toggle, or hidden
   behind a setting. The mechanism is a UX call, not auto-derivable.

3. **Persona override semantics are fallback, not stack.** A persona
   override REPLACES the conversation prompt, doesn't append. When
   every persona has an override, the conversation prompt is dead
   code for that conversation — the editor must either grey it out
   with a "shadowed by all personas" note or the user will edit a
   field that never reaches the LLM.

4. **`null` vs `""` matters.** `persona.systemPromptOverride = null`
   means "fall through to conversation.systemPrompt"; `""` means
   "explicit empty, skip the local layer entirely." A textarea
   that conflates these will silently re-route content. The dialog
   needs an explicit "use conversation default" checkbox per persona
   alongside the textarea.

5. **Edits don't rewrite history.** Past replies were generated
   against the old prompts; only future turns see the change. The
   dialog needs a one-line note saying so, otherwise users will
   wonder why the persona's old answers don't reflect the new
   prompt.

**Why deferred:** Build the viewer (`//activeprompts`, this commit)
first and see whether it closes the gap on its own. The viewer
makes "what is each persona actually getting?" answerable in one
notice, and the existing scattered fields (Settings · General +
persona panel + conversation settings) may be enough once you
know which one to navigate to. If after a week the editor still
feels like a clear win, the viewer naturally becomes its read-only
mode and the editor is "viewer + textareas per row + three save
paths."
