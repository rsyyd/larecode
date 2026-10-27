---
title: Surface contract
parent: Architecture
nav_order: 1
description: How each surface starts, streams, cancels, and stops a runtime turn
---

# Surface contract

Every surface runs the same `AgentRuntime` turn. Lifecycle APIs differ because the hosts differ, but each one maps the same five operations onto the runtime contract.

| Surface     | Start                         | Stream                           | Cancel            | Stop             | Status                            |
| ----------- | ----------------------------- | -------------------------------- | ----------------- | ---------------- | --------------------------------- |
| TUI / chat  | `larecode chat`               | Runtime events in the transcript | Esc during a turn | Ctrl+C           | Footer model, tokens, cost, agent |
| CLI run     | `larecode run "<task>"`       | Text to stdout                   | SIGINT            | Process exit     | Exit code `0`, `1`, `3`, or `130` |
| HTTP server | `Server.start()`              | SSE `chunk` events               | Client disconnect | `Server.stop()`  | `GET /health`                     |
| ACP         | `AcpAgent.serve()`            | `session/update`                 | `session/cancel`  | stdin close      | `initialize` capability response  |
| Gateway     | `TelegramGateway.run(signal)` | `sendMessage`                    | Abort signal      | Abort signal     | Polling log and per-chat session  |
| Cron        | `larecode cron start`         | Job result log                   | SIGINT            | Process exit     | `larecode cron list`              |
| SDK         | `LareClient.run()`            | `onChunk` callback               | `AbortSignal`     | Promise resolves | `RunResult.stopReason`            |

The runtime guarantees:

- one terminal `halt` or `error` per turn,
- `cancelled` after an abort instead of a thrown cancellation error,
- tool call IDs that correlate start and end events,
- usage accounting from provider usage when available.

`packages/cli/src/surface-matrix.test.ts` exercises chat, run, server, ACP, gateway, cron, and SDK against one fake runtime, including history, tools, cancellation, and cross-surface session continuity.
