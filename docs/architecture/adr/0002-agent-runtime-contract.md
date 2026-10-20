---
title: ADR-0002 Agent runtime contract
nav_order: 11
description: One runtime contract for the TUI, CLI, server, ACP, gateway, cron, and SDK
---

# ADR-0002: One agent runtime contract for every surface

Date: 2026-10-20

## Status

Accepted

## Context

Lare Code has two separate agent paths:

- The TUI uses `ChatSession`, which runs tools, permission checks, history, and usage.
- `run`, `serve`, `acp`, the Telegram gateway, cron, and the SDK use `AgentLoop`, which sends one prompt to one completion and has no tools.

That split causes user-visible divergence: the same prompt can edit files in the TUI but cannot edit them from `run`; server and gateway history is stored but not sent back to the model; empty responses and halts are not represented consistently.

Every surface also needs the same events: streamed text, tool start, tool end, usage, a terminal reason, and a structured error. Without a shared contract each surface invents its own translation layer.

## Decision

Define `AgentRuntime` in `packages/core/src/agent/runtime.ts` as the single contract for agent turns.

A turn takes a prompt, an `AbortSignal`, an optional primary agent (`plan` or `build`), and an optional permission confirmation callback. It returns an async iterable of events:

- `text`
- `tool_start`
- `tool_end`
- `usage`
- `halt` with a reason: `completed`, `iterations`, `tool_calls`, `budget`, `duration`, `cancelled`, or `error`
- `error` with a serializable `LareErrorJSON`

A runtime also exposes its session ID, provider, model, history, aggregate usage, agent selection, model selection, and reset.

Cancellation is expressed through the per-turn `AbortSignal`. Implementations must stop streaming, stop tool execution, and emit a `halt` event with reason `cancelled`; they must not throw a cancellation error after the stream has started.

ARC-02 implements `DefaultAgentRuntime` and makes `ChatSession` a thin adapter over it. ARC-03 adds `AgentRuntimeLoop` and moves `run`, server, gateway, cron, and SDK/ACP onto the runtime. Those surfaces run the build agent with their working directory; gateway and cron pass an unattended permission policy. Runtime options may include prior history, and server, gateway, and SDK/ACP replay stored messages each turn. `AgentLoop` remains only for the not-yet-wired subagent path until RUN-18.

## Consequences

Easier:

- Every surface can consume the same events and render or serialize them without guessing.
- Errors and halt reasons can cross the server, ACP, gateway, and SDK boundaries.
- The TUI, CLI, automation, and tests can use one fake runtime.
- Tool call IDs are part of the contract, so tool start and tool end can be correlated.

Harder:

- `ChatSession` must become an adapter rather than the primary implementation.
- `AgentLoop` must be retired from the agent path; it cannot simply gain tools without duplicating the runtime.
- Every surface must handle `halt` and `error` events explicitly instead of relying on an empty return.

## Alternatives considered

- Add tools to `AgentLoop` and keep both paths. Rejected: two loops would keep diverging and the TUI path would remain the only complete one.
- Make `ChatSession` the contract. Rejected: it carries TUI-oriented options and does not expose a serializable event stream.
- Use callbacks instead of an async iterable. Rejected: callbacks make backpressure, cancellation, and multi-surface consumption harder to reason about.
