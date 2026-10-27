---
title: ADR-0004: Context injection
parent: Architecture
nav_order: 5
description: What the model sees each turn: budgeted, sanitized, and inspectable
---

# ADR-0004: Context injection

Status: accepted

## Context

Agents need project awareness without exhausting the model window. Context sources are repo structure, relevant file retrieval, project memory, and instruction files. Each has different cost and freshness.

## Decision

`ContextBuilder` assembles a bounded context block before each turn. Sources are toggled in config (`context.repoMap`, `context.retrieval`, `context.memory`) and the total is capped by `context.budgetTokens` (default 8000). Repo maps use a cached workspace snapshot per project and flags. Retrieved content is sanitized: control characters and ANSI escapes are stripped and prompt-injection markers are neutralized before injection. `/context` prints the assembled report, including what was included and what was skipped.

Compaction runs when estimated tokens cross `compactAtTokens`; older tool output is replaced with a summary marker while recent tool calls stay intact.

## Consequences

- Deterministic budgets; a large repo cannot silently blow the window.
- Caching keeps indexing near ~1s on medium repos.
- Sanitization may drop legitimately odd content (binary-ish text) from context.
- Retrieval quality is heuristic, not semantic embeddings; see the eval harness in `packages/core/src/context/context.test.ts` for the current fixture expectations.
