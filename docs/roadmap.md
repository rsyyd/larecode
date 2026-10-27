---
title: Roadmap
nav_order: 17
description: What is released, what each version adds, and what gates the 1.0 release
---

# Roadmap

No release dates are promised. Each version ships when its exit criteria pass, and each minor waits for the previous one to be stable for 14 days since its actual publish time. The maintainer can waive a window explicitly; when that happens it is recorded here, not silently skipped.

## Released

- **0.1.0** — monorepo scaffold, config system, basic agent loop, tools, permissions, sessions.
- **0.1.1** — end-to-end release pipeline, checksums, packaging manifests.
- **0.2.0** — provider-neutral agent loop, permissions, sessions, tools, CLI/TUI, server, gateway, cron, MCP, skills, subagents, checkpoints.
- **0.3.0** — smart context with repo map, retrieval, memory, compaction, and sanitization; provider fallback and per-model `doctor`; parallel read-only tools; MCP trust fingerprints and private-network blocking; TUI queue and session controls; metrics, usage, debug bundle, crash reports, and the hash-chained audit log.
- **0.4.0** (2026-10-27) — interaction depth: safe markdown/code rendering, diff view, compact tool panels, in-conversation search, copy/export, `@` file mentions, `/sessions` filtering, shell completion, `skill author|install|list` with draft-state and consent gating, `en/id` onboarding locale, opt-in live provider and `clangd` smoke runs, the permission-gated demo video, CLI logs on stderr, and the `body-parser` advisory fix. The 14-day window after 0.3.0 was waived by the maintainer on the release date.

## 0.5.0 — hardening and performance

Already built on `main` ahead of the tag: the repeatable benchmark suite (`bun run bench`), the CLI startup budget, and the index/memory budget behind a CI gate.

Exit criteria: the perf gate is green in CI, `bun run bench` records baseline numbers in the repo, and no test regresses. 0.5.0 also opens the external security audit engagement; the audit is the long lead item and is required before 1.0.0, not before this tag.

## 0.6.0 — the extensions platform goes live

The plugin loader and trust model exist today; the runtime does not activate them yet. This version turns them on.

- Activate lifecycle hooks and plugin tools in the main surfaces, behind the explicit allowlist.
- Sandbox untrusted project plugins (out-of-process, timeout, fail-closed) and keep the provenance checks.
- Skill catalog UX: browse, approve, and revoke community skills from one list.

Exit criteria: hook and plugin tests run in the main-surface suites, an unapproved plugin cannot execute anything, and the extensions guide documents the allowlist end to end.

## 0.7.0 — retrieval intelligence

- Optional local semantic (embedding) retrieval as an additional ranking signal, hybrid with today's lexical and structural search; off by default, no cloud, no model download without consent.
- Context quality metrics upgraded to compare hybrid ranking against the lexical baseline on the fixture corpus.

Exit criteria: hybrid retrieval beats the lexical baseline on the retrieval eval without regressing the index/memory budget.

## 0.8.0 — surfaces and platforms

- First-class Windows terminal support: native PowerShell and cmd sessions without WSL, with the TUI reflowed and tested there in CI.
- SDK and ACP polish for editor integrations, and gateway/share-link hardening toward the multi-owner model, still single-owner by default.

Exit criteria: CI runs the Windows terminal job green, and the SDK surface contract test covers every documented operation.

## 0.9.0 — release candidate hardening

- API freeze candidates for 1.0: every public interface is documented, tested, and marked stable or experimental.
- Accessibility pass over the TUI and the site, plus a performance budget tightened from the 0.5 baselines.
- The external security audit report lands with findings triaged and fixed.

Exit criteria: audit findings are closed or accepted in writing, and the API freeze list is reviewed with no open objections.

## 1.0.0 gates

- 0.9.x must be stable for 30 days.
- The external security audit must be complete with findings resolved.
- The public API is frozen; breaking changes wait for 2.0.
- Version numbers alone do not signal stability; these gates do.

## Not planned

Telemetry, cloud sync of sessions or memory, implicit provider fallback, or plugin execution without an explicit allowlist.
