# Contributing

How work happens on mchat2. Read this once on join, reference it daily.

The rules are strict on purpose. The version-bump script depends on commit
message conventions; the test-first rule keeps tests honest; the issue-first
rule keeps the historical record coherent. Most violations break something
silently.

---

## Setup

### Prerequisites

- **Node 20+**
- **Rust stable** with `cargo` on PATH
- **OS-specific Tauri prerequisites** — see
  [Tauri's setup guide](https://v2.tauri.app/start/prerequisites/) for your
  platform (Windows: WebView2, macOS: Xcode CLI tools, Linux: webkit2gtk).

### First-time setup

```bash
git clone <this-repo>
cd mchat2
npm install
npm run tauri dev
```

The first `npm install` also installs Playwright browsers if you've used
Playwright before; otherwise run `npx playwright install` to grab them.

The first `cargo` build is slow (a few minutes — Tauri pulls a lot of
dependencies). Subsequent builds are incremental and fast.

### Where state lives during development

- **SQLite database** — under the OS app-data directory for the bundle
  id `email.heinen.mchat2` (`%APPDATA%\email.heinen.mchat2\` on Windows,
  `~/Library/Application Support/email.heinen.mchat2/` on macOS,
  `~/.local/share/email.heinen.mchat2/` on Linux). Filename: `mchat2.db`.
- **API keys** — in the OS keychain under service name `mchat2`.
- **Trace files** — when tracing is enabled, under the working directory
  the user picks via the file dialog.

To start fresh: close the app, delete `mchat2.db`, restart.

---

## Day-to-day commands

```bash
npm run tauri dev      # full app, hot-reloads webview
npm run dev            # webview only (no Tauri shell — useful for UI work
                       # that doesn't exercise plugins)

npm test               # vitest unit suite (run once)
npm run test:watch     # vitest watch mode
npm run test:e2e       # playwright e2e (mock provider, full Tauri app)

npm run lint           # eslint with --max-warnings=0
npm run format         # prettier write
npm run format:check   # prettier check (CI mode)

npx tsc --noEmit       # typecheck without emitting

npm run bump -- -m "chore: bump version for #NNN"   # version bump (see below)

npm run tauri build    # release binary
```

The Tauri Rust side has its own check loop:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

This is slower (3 minutes from a clean state) but worth running before
committing changes that touch `src-tauri/`.

---

## Issue-first workflow

**File a `gh issue create` BEFORE any non-trivial code change.** Even
small fixes from review or analysis. The issue number is referenced in
commit messages and the version-bump script depends on it.

```bash
gh issue create --title "Short clear title" --body "$(cat <<'EOF'
## Problem
…
## Plan
…
## Tradeoff
…
EOF
)"
```

Search prior issues before filing:

```bash
gh issue list --search "<keyword>" --state all
gh issue list --search "<keyword>" --state all --json number,title,body --jq '.[].body' | head
```

If a new concern is a follow-up or fix to existing tracked work, **extend
the existing issue rather than fork**. Reopen, comment, or add a "follow-up"
section. Each commit-message reference (`#NNN`) keeps the historical thread
in one place.

A genuinely new concern (different surface, different motivation, no
overlap) gets its own issue.

Address issues one at a time, not in batches.

---

## Test-first workflow

When a change has tests (most do), follow this strict sequence:

### 1. Tests first

Write or update tests for the desired outcome. Run them and confirm the
new/updated tests **fail** — proving they test the right thing.

```bash
npm test -- path/to/relevant.test.ts
```

Commit the test changes alone with a `tests:` prefix:

```bash
git add tests/...
git commit -m "tests: pin <contract> (#NNN)"
```

### 2. Implement

Change the main code to make the tests pass. **Do NOT touch test files in
this step.** Commit with a fix/feat/refactor prefix and the issue reference:

```bash
git add src/...
git commit -m "fix: <one-line summary> (#NNN)

<body explaining the why>"
```

Run the suite to confirm everything passes.

### 3. Iterate

If tests still fail, fix the implementation, re-commit, re-run. If a test
itself is faulty, change **only the test**, commit it as a separate `tests:`
commit, and confirm it fails (against the prior implementation) before going
back to implementation.

**Never mix test changes and implementation changes in the same commit.**
This is the strictest rule. If you find yourself wanting to, stash the
implementation, fix the test, commit, restore the implementation.

---

## Required commit sequence (the trio)

For non-trivial work the project ships in three commits per issue:

```
1. tests: pin <contract> (#NNN)
2. fix: <change> (#NNN)
3. chore: bump version for #NNN
```

The version bump goes last because the bump script reads the issue number
from the commit message and writes new versions into 5 files. Doing it
between (1) and (2) leaves the working tree dirty during implementation.

For trivial code changes (single-line fix, no behavior under test), the trio
collapses to:

```
1. fix: <change> (#NNN)
2. chore: bump version for #NNN
```

For doc-only commits (`docs:` prefix — typo fixes, accuracy patches, ADR
status notes, comment edits in markdown files) the trio collapses further
to a **single commit, no version bump**:

```
1. docs: <change> (#NNN)
```

The bump script also no-ops on `tests:`-prefixed messages, so a standalone
test pin commit does not trigger a bump. The version only advances when
shipped behavior changes — code or non-trivial doc additions; pure doc
accuracy work doesn't.

---

## Versioning and bump-version.mjs

mchat2 uses **issue-based versioning**: `MAJOR.MINOR.BUILD` where:

- `MAJOR = floor(issue / 100)`
- `MINOR = issue % 100`
- `BUILD = a counter that increments on each bump within the same MAJOR.MINOR`

Examples:

- Issue #277 → version `2.77.X`
- Issue #284 → version `2.84.X`
- Two commits for #277 in succession → `2.77.1` then `2.77.2`

The version **never goes backwards.** If you ship #274 after already shipping
#277, it stays at `2.77.X` (the next free `2.77.X` slot).

### How to bump

After the implementation commit lands cleanly:

```bash
node scripts/bump-version.mjs -m "chore: bump version for #NNN"
git commit -m "chore: bump version for #NNN"
```

Or via npm:

```bash
npm run bump -- -m "chore: bump version for #NNN"
git commit -m "chore: bump version for #NNN"
```

The script:

1. Parses the first `#NNN` from the commit message.
2. Loads `.build-counter.json` and computes the next version per the
   never-go-backwards rule.
3. Writes the new version into:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock` (the `[[package]] mchat2` entry — see #207 for
     why; cargo would otherwise rewrite this on next build and dirty the
     working tree)
   - `.build-counter.json`
4. Stages all five files with `git add`.

You then run `git commit` separately to make the bump commit.

If the message starts with `tests:` the script no-ops — test commits don't
trigger version bumps.

---

## Commit conventions

### Message format

```
<type>: <one-line summary> (#NNN)

<body explaining the why — context and intent, not just the diff>

<optional Co-Authored-By line>
```

`<type>` is one of: `tests`, `fix`, `feat`, `refactor`, `docs`, `chore`.

The summary should describe the **what** in one line; the body should explain
the **why**. The version-bump script and downstream tooling parse `#NNN`
from anywhere in the message.

### Hooks and signing

- **Never use `--no-verify`.** Pre-commit hooks run lint and (on bigger
  branches) the full vitest suite. If a hook fails, fix the underlying
  issue. The only acceptable bypass is when the user explicitly asks for
  one in writing.
- **Never use `--no-gpg-sign`** unless the user explicitly says so.
- **Never amend a published commit.** Create a new commit instead.
- **Never `git push --force`** to `main` without explicit user approval.

### Co-author lines

When committing on behalf of an AI assistant, include the appropriate
`Co-Authored-By` line at the end of the message. The format used in this
project's history is:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## ADR policy

For every non-trivial design choice, write a short Architecture Decision
Record under `docs/decisions/NNN-short-title.md`. Numbered sequentially.

An ADR captures:

- **The decision** — what we did.
- **Alternatives considered** — what we didn't do and why.
- **Tradeoff** — what the cost is.

ADRs are ~200 words. They're not a design doc; they're a frozen-in-time
explanation of why we chose option A over B at that moment, so future-you
doesn't have to re-litigate the question.

The legacy `docs/DECISIONS.md` chronological log is kept for historical
context but is no longer the primary place for new decisions — file
per-decision under `docs/decisions/` instead.

The recommended reading order for new contributors is in
[docs/decisions/README.md](decisions/README.md).

---

## What does NOT belong in code

The project has strict conventions about what goes in source vs. PR
descriptions vs. documentation:

- **No "WHAT this does" comments.** Well-named identifiers should make
  the what obvious. Comments are for the **why** — hidden constraints,
  subtle invariants, workarounds for specific bugs.
- **No "added for X" or "used by Y" comments.** That belongs in the PR
  description and rots as the codebase evolves.
- **No multi-paragraph docstrings.** One short line max if you write one
  at all.
- **No dead-code retention.** If something is unused, delete it. Don't
  leave `// removed in #X` comments behind.
- **No backwards-compatibility shims** for code that isn't shipped to
  external consumers. The DB has migrations; the API has provider adapters;
  the rest can change shape freely.
- **No future-proof abstractions.** Three similar lines is better than a
  premature factory. Add the abstraction when the third caller arrives.

---

## Where to look when stuck

- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — how the system fits together.
- [docs/troubleshooting.md](troubleshooting.md) — concrete symptoms →
  fixes.
- [docs/recipes.md](recipes.md) — how to add a slash command, repo
  method, migration, provider, etc.
- [docs/decisions/](decisions/) — why we made the architectural choices
  we did.
- `gh issue list` — historical context for almost every code path.
