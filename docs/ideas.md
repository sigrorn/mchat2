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
