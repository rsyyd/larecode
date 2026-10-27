---
title: ADR-0005: Permissions and audit
parent: Architecture
nav_order: 6
description: Grouped tool calls, default-deny, and a tamper-evident audit chain
---

# ADR-0005: Permissions and audit

Status: accepted

## Context

Every tool can read, write, run commands, reach the network, or spend subagent budget. The default must be safe for unattended use, while interactive users should not be prompted for routine reads.

## Decision

Permissions are grouped (`read`, `write`, `shell`, `network`, `browser`, `skills`, `subagent`, `external-services`) and checked on every tool call in the shared runtime, so CLI, server, gateway, cron, and SDK behave identically. Modes are `ask` (confirm when required), `allow`, and `deny`; unattended runs never receive implicit confirmation. Gateway and cron pass an explicit pre-authorized group list instead of granting everything.

Each decision is recorded in an in-memory `AuditLog` and can be appended to a local hash-chained file (`hashChainAuditSink`). `larecode audit --verify` recomputes the chain and reports the first broken or tampered entry. Audit entries carry group, decision, source, and unattended state, never tool arguments.

## Consequences

- One enforcement point means surfaces cannot drift.
- The audit file is local only; no telemetry.
- The chain detects edits and removals but not truncation of the whole tail; pair it with file permissions and backups.
- Tool arguments are intentionally excluded, so the log proves decisions, not payloads.
