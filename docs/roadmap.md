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

0.4.0 cannot ship before 0.3.0 has been stable for 14 days (not before 2026-11-05).

## Planned — 0.5.0

Team and automation surface expansion after the 0.4 stability window.

## 1.0.0 gates

- 0.3.0 must be stable for 14 days before 0.4.0.
- 0.4.0 must be stable for 14 days before 0.5.0.
- 0.5.x must be stable for 30 days and pass an external security audit.
- No 1.0.0 tag before those gates. Version numbers alone do not signal stability.

## Not planned

Telemetry, cloud sync of sessions or memory, implicit provider fallback, or plugin execution without an explicit allowlist.
