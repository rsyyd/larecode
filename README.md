# Lare Code

> Every agent's best, in one CLI.

Lare Code is an open-source, provider-neutral AI coding agent for the terminal.
It combines the proven advantages of opencode, Claude Code, Codex CLI, Gemini CLI,
and Hermes Agent into one coherent, local-first CLI.

**Status:** early development (M0).
**Spec:** [PRD.md](PRD.md) · **License:** [MIT](LICENSE)

## Install

```bash
npm install -g larecode        # Node 20+
curl -fsSL https://raw.githubusercontent.com/rsyyd/lare/main/install.sh | sh
brew tap rsyyd/lare && brew install larecode
```

Then `larecode setup`, `larecode doctor`, `larecode run "explain this repository"`.

## Docs

- [Getting started](docs/getting-started.md) · [Configuration](docs/configuration.md) · [Providers](docs/providers.md)
- [Permissions](docs/permissions.md) · [Tools](docs/tools.md) · [MCP](docs/mcp.md)
- [Automation](docs/automation.md) · [SDK and editors](docs/sdk.md) · [Install options](docs/install.md)
- [Security and trust model](SECURITY.md)

The docs publish as a site from `docs/` on every push to main.

## Usage

```bash
bun install
bun run dev            # run the CLI from source
bun run build          # compile dist/larecode
bun run build:npm      # bundle the npm package into npm/dist
./dist/larecode doctor
```

## Development

```bash
bun run typecheck      # tsc --noEmit
bun run test           # vitest
bun run lint           # oxlint
bun run format         # prettier
```

## Editors and SDK

`larecode acp` speaks the Agent Client Protocol over stdio, ready for editor integrations such as Zed. The same core is embeddable from TypeScript:

```ts
import { LareClient } from '@larecode/sdk';

const client = new LareClient();
const result = await client.run('explain this repository', {
  onChunk: (chunk) => process.stdout.write(chunk),
});
console.log(result.usage.totalTokens.total);
```

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
[PRD.md § 9](PRD.md#9-execution-model-task-splitting-rules-mandatory). One task
per focused session: never the whole build in one process.
