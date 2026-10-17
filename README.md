# Lumps Code

> Every agent's best, in one CLI.

Lumps Code is an open-source, provider-neutral AI coding agent for the terminal —
combining the proven advantages of opencode, Claude Code, Codex CLI, Gemini CLI,
and Hermes Agent into one coherent, local-first CLI.

**Status: PRD stage.** Implementation follows the task breakdown in the spec —
one task per focused session, never the whole build in one process.

- Product specification: [PRD.md](PRD.md)
- License: [MIT](LICENSE)

## Task index

The PRD splits the build into 32 independent tasks across 5 milestones:

| Milestone | Theme                                                           | Tasks       |
| --------- | --------------------------------------------------------------- | ----------- |
| M0        | Foundation (repo, config, CI)                                   | T-01 – T-03 |
| M1        | Core agent MVP (providers, tools, TUI)                          | T-04 – T-12 |
| M2        | Intelligence & extensibility (LSP, MCP, skills, plan mode)      | T-13 – T-21 |
| M3        | Differentiators (learning loop, server, sharing, gateway, cron) | T-22 – T-28 |
| M4        | Polish & distribution                                           | T-29 – T-32 |

Each task lists its scope, dependencies, and acceptance criteria in
[PRD.md § 9](PRD.md#9-execution-model--task-splitting-rules-mandatory).
