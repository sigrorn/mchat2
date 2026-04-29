# Ideas

Ideas that came up in design discussions but were deferred or not pursued.
Kept here so future-us can revisit without having to re-derive the
context from scratch.

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
