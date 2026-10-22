---
title: Roadmap
nav_order: 15
description: What is released, what is in progress, and what gates the 1.0 release
---

# Roadmap

No release dates are promised. Each version ships when its exit criteria pass.

## Released

- **0.2.0** — provider-neutral agent loop, permissions, sessions, tools, CLI/TUI, server, gateway, cron, MCP, skills, subagents, checkpoints.

## In progress — 0.3.0 "Smart context"

- Context assembly with repo map, retrieval, memory, budget, and sanitization.
- Compaction that keeps recent tool calls intact.
- Parallel read-only tool execution with serial fallback.
- Runtime metrics, local usage summary, debug bundle, crash report.
- Hash-chained audit log and `larecode audit --verify`.
- Session locking across surfaces; explicit provider fallbacks; per-model `doctor`.
- TUI prompt queue, session picker, status bar, model health.

Exit criteria: context retrieval, repo map, memory, and compaction tests pass; provider and tool P1 tests pass; automation and extension P1 tests pass; no permission or session regressions.

## Planned — 0.4.0

Rendering and interaction depth: safe markdown/code rendering, diff view, compact tool panels, in-conversation search, copy/export, `@` file mentions.

## Planned — 0.5.0

Team and automation surface expansion after the 0.4 stability window.

## 1.0.0 gates

- 0.3.0 must be stable for 14 days before 0.4.0.
- 0.4.0 must be stable for 14 days before 0.5.0.
- 0.5.x must be stable for 30 days and pass an external security audit.
- No 1.0.0 tag before those gates. Version numbers alone do not signal stability.

## Not planned

Telemetry, cloud sync of sessions or memory, implicit provider fallback, or plugin execution without an explicit allowlist.
