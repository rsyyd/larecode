---
title: ADR-0003: Session store
parent: Architecture
nav_order: 4
description: Sessions survive restarts as lockable files shared by every surface
---

# ADR-0003: Session store

Status: accepted

## Context

Chat sessions must survive restarts and be shared across surfaces (CLI, server, gateway). Earlier drafts considered a database; the team chose files to keep zero-dependency, inspectable, and editable by hand.

## Decision

Sessions live as one JSON file per session under `LARECODE_HOME/sessions/`. The file is written with a temp-file + atomic rename, owner-only permissions, and secret redaction before serialization. A `.lock` file serializes concurrent writers across processes; stale locks (older than 10s) are reclaimed, and a fresh lock times out after 2s with `SESSION_LOCKED`.

## Consequences

- Session files are diffable and script-friendly.
- No DB daemon or schema migration chore for local use.
- Cross-process safety relies on the lock; atoms outside the file (checkpoints, memory) are not covered by this lock.
- Redaction means tool result secrets are elided on disk but kept in memory for the session.
