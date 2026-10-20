<p align="center">
  <img src="docs/assets/banner.svg" alt="Lare Code" width="896">
</p>

<p align="center">
  <a href="https://github.com/rsyyd/larecode/actions/workflows/ci.yml"><img src="https://github.com/rsyyd/larecode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/larecode"><img src="https://img.shields.io/npm/v/larecode" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/rsyyd/larecode" alt="License: MIT"></a>
</p>

Lare Code is an open-source AI coding agent for the terminal. It runs on your machine, works with any OpenAI-compatible provider (plus Anthropic, Ollama, OpenRouter, and custom endpoints), and checks every tool call against a permission policy before it runs.

Status: early release (0.1.x). See the [changelog](CHANGELOG.md) for what changed and what is planned.

## Features

- **Provider neutral.** OpenAI-compatible, Anthropic, Ollama, OpenRouter, Z.ai, and custom endpoints, with per-run `--provider` and `--model` overrides.
- **Permission engine.** Every tool call maps to a permission group; the default is deny, secrets and destructive operations always require confirmation, and every decision lands in an audit log.
- **Agent loop.** Multi-provider chat, plan mode, subagents, skills, hooks, plugins, checkpoints, memory, and session search.
- **Code aware.** Built-in file tools plus structural search via `ast-grep` and language server queries via LSP.
- **MCP both ways.** Consume external MCP servers, or expose larecode tools to editors and other agents over stdio.
- **Automation.** HTTP API with scoped tokens, share links, cron jobs, and a Telegram gateway, all running under the same permission policy.

## Install

```bash
npm install -g larecode        # Node 20+
curl -fsSL https://raw.githubusercontent.com/rsyyd/larecode/main/install.sh | sh
brew tap rsyyd/larecode && brew install larecode
```

Windows: `scoop bucket add larecode https://github.com/rsyyd/larecode-scoop && scoop install larecode`. Arch Linux and manual binaries are covered in [install options](docs/install.md).

## Quick start

```bash
larecode setup
larecode doctor
larecode run "explain this repository"
```

`setup` writes `~/.larecode/config.json`, `doctor` verifies your configuration and provider, and `run` streams the result with token and cost totals:

```console
$ larecode run "find the slowest test and explain why it is slow"
Reading vitest.config.ts
Searching for test files
...
tokens: 12,481 (input 11,204, output 1,277)  est. cost $0.031
```

Add `--verify` to record a test baseline first and fail only if new test failures appear.

## Documentation

- [Getting started](docs/getting-started.md) · [Install options](docs/install.md) · [Configuration](docs/configuration.md)
- [Providers](docs/providers.md) · [Permissions](docs/permissions.md) · [Tools](docs/tools.md)
- [MCP](docs/mcp.md) · [Automation](docs/automation.md) · [SDK and editors](docs/sdk.md) · [CLI reference](docs/cli.md)

## Development

```bash
bun install
bun run dev            # run the CLI from source
bun run build          # compile dist/larecode

bun run typecheck      # tsc --noEmit
bun run test           # vitest
bun run lint           # oxlint
bun run format         # prettier
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## Contributing

Bug reports, documentation fixes, and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the checks every change must pass.

## Security

Report vulnerabilities privately through [GitHub security advisories](https://github.com/rsyyd/larecode/security/advisories/new). See [SECURITY.md](SECURITY.md) for the supported versions, scope, and the full trust model.

## License

[MIT](LICENSE)
