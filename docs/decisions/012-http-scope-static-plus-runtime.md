# 012 — HTTP allowlist: static for known hosts, runtime `add_capability` for custom presets

Date: 2026-06-06 ([#297](https://github.com/sigrorn/mchat2/issues/297))
Status: Accepted

## Decision

Keep the static `tauri-plugin-http` URL allowlist in
`src-tauri/capabilities/default.json` for every host known at build time —
the native provider APIs **and** the four built-in `openai_compat` presets
(OpenRouter, OVHcloud, IONOS, Infomaniak). For **custom** user-added presets,
whose base URL is unknown until runtime, register the host into the HTTP scope
at runtime via Tauri v2's `Manager::add_capability` (a Rust command
`register_http_hosts`, called from the frontend at startup and after the
Providers dialog saves a custom preset).

## Context

All outbound HTTP routes through `tauri-plugin-http`, which enforces a per-URL
scope. Three of the four built-in presets (OpenRouter, OVHcloud, IONOS) were
never added to that scope, so their `/models` and chat calls were blocked at the
Tauri layer and silently fell back to an empty list (#297 root cause). Custom
presets — arbitrary endpoints the user types in — cannot be enumerated at build
time at all, so no static list can ever cover them.

Tauri v2 exposes runtime capability injection: `Manager::add_capability` (since
2.0.0-beta.3) plus `tauri::ipc::CapabilityBuilder::permission_scoped`, gated
behind the default-on `dynamic-acl` feature. A runtime capability targeting the
`main` window unions its `http:default` scope into the effective allow-set.

## Alternatives considered

1. **Static-only (just add the three built-in hosts).** Simplest, fixes the
   reported bug, but leaves custom presets permanently broken — the second half
   of the same bug. Rejected as incomplete.
2. **Wildcard scope `https://*/*`.** Makes everything work in one line but
   defeats the purpose of the allowlist and directly conflicts with the
   pre-release hardening tracked in #115. Rejected.
3. **Read preset config from Rust at startup and register everything there.**
   Avoids a frontend-callable scope command, but the preset/custom config lives
   in the JS-side settings table (Kysely/SQL bridge); reaching it from Rust
   duplicates schema knowledge across the language boundary. Rejected — the
   resolver and config already live in TS.

## Tradeoff

- **Tight scope preserved:** only configured hosts are ever allowed; no blanket
  wildcard. Built-in hosts are auditable in `default.json`; custom hosts are
  added one-by-one as the user configures them.
- **Belt-and-suspenders:** built-in compat hosts are static even though the
  runtime path could also cover them — so the four shipped presets work even if
  `dynamic-acl` is ever disabled or the startup registration call fails.
- **Trust surface:** `register_http_hosts` lets the (trusted, first-party)
  frontend widen the HTTP scope. If the renderer were compromised it could
  whitelist arbitrary hosts — acceptable for a desktop LLM client where the
  renderer is our own code; #115 hardening (CSP) constrains that surface
  separately. No revocation API exists in Tauri v2, so hosts persist for the
  process lifetime; the dedup set keeps identifiers unique.
