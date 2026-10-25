---
title: Roadmap
nav_order: 15
description: What is released, what is in progress, and what gates the 1.0 release
---

# Roadmap

No release dates are promised. Each version ships when its exit criteria pass.

## Released

- **0.2.0** — provider-neutral agent loop, permissions, sessions, tools, CLI/TUI, server, gateway, cron, MCP, skills, subagents, checkpoints.
- **0.3.0** — smart context with repo map, retrieval, memory, compaction, and sanitization; provider fallback and per-model `doctor`; parallel read-only tools; MCP trust fingerprints and private-network blocking; TUI queue and session controls; metrics, usage, debug bundle, crash reports, and the hash-chained audit log.

0.3.0 meets its exit criteria: context retrieval, repo map, memory, and compaction tests pass; provider and tool P1 tests pass; automation and extension P1 tests pass; and the permission and session suites show no regressions.

## Planned — 0.4.0

Rendering and interaction depth: safe markdown/code rendering, diff view, compact tool panels, in-conversation search, copy/export, `@` file mentions.

Built on `main` ahead of the tag: TUI markdown/diff/compact panels, `/search`, `/copy`, `/export`, `@file` mentions, `/sessions <query>` filtering, shell completion, `larecode skill author|install|list` with draft-state and consent gating, the CDP browser tool with a fake-endpoint test, opt-in live provider and `clangd` smoke runs, the `en/id` onboarding locale, and a new demo: the cast now records a real permission prompt and the docs front page plays an MP4 rendered with HyperFrames.

0.4.0 cannot ship before 0.3.0 has been stable for 14 days (not before 2026-11-05).

## Planned — 0.5.0

Hardening and performance after the 0.4 stability window.

Built on `main` ahead of the tag: the repeatable benchmark suite (`bun run bench`), the CLI startup budget, and the index/memory budget behind a CI gate.

0.5.0 also requires an external security audit; the audit cannot be self-performed and is the long lead item before the tag.

## 1.0.0 gates

- 0.3.0 must be stable for 14 days before 0.4.0.
- 0.4.0 must be stable for 14 days before 0.5.0.
- 0.5.x must be stable for 30 days and pass an external security audit.
- No 1.0.0 tag before those gates. Version numbers alone do not signal stability.

## Not planned

Telemetry, cloud sync of sessions or memory, implicit provider fallback, or plugin execution without an explicit allowlist.
