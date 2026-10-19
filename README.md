# Lare Code

Lare Code is an open-source AI coding agent for the terminal. It runs on your machine, works with any OpenAI-compatible provider (plus Anthropic, Ollama, OpenRouter, and custom endpoints), and checks every tool call against a permission policy before it runs.

**Status:** early release (0.1.x), see [CHANGELOG.md](CHANGELOG.md) · **License:** [MIT](LICENSE)

## Install

```bash
npm install -g larecode        # Node 20+
curl -fsSL https://raw.githubusercontent.com/rsyyd/larecode/main/install.sh | sh
brew tap rsyyd/larecode && brew install larecode
```

Windows: `scoop bucket add larecode https://github.com/rsyyd/larecode-scoop && scoop install larecode`. Arch Linux and manual binaries are covered in [install options](docs/install.md).

Then `larecode setup`, `larecode doctor`, `larecode run "explain this repository"`.

## Docs

- [Getting started](docs/getting-started.md) · [Configuration](docs/configuration.md) · [Providers](docs/providers.md)
- [Permissions](docs/permissions.md) · [Tools](docs/tools.md) · [MCP](docs/mcp.md)
- [Automation](docs/automation.md) · [SDK and editors](docs/sdk.md) · [Install options](docs/install.md)
- [Security and trust model](SECURITY.md)

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
