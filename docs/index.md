# Lumps Code docs

Lumps Code is an open-source, provider-neutral AI coding agent for the terminal. This folder is the documentation site source, published with GitHub Pages.

| Page                                     | What it covers                                             |
| ---------------------------------------- | ---------------------------------------------------------- |
| [getting-started.md](getting-started.md) | Install, first run, config location                        |
| [configuration.md](configuration.md)     | Global and project config, environment variables           |
| [providers.md](providers.md)             | OpenAI-compatible, Anthropic, Ollama, and custom providers |
| [permissions.md](permissions.md)         | Permission groups, modes, unattended flows, audit log      |
| [tools.md](tools.md)                     | Built-in tools and how they map to permission groups       |
| [mcp.md](mcp.md)                         | MCP client config and `lumpscode mcp serve` server mode    |
| [automation.md](automation.md)           | HTTP server, share links, cron jobs, Telegram gateway      |
| [sdk.md](sdk.md)                         | TypeScript SDK and the ACP adapter for editors             |
| [install.md](install.md)                 | npm, curl, Homebrew, Scoop, AUR, manual installs           |

## Full command reference

| Command                                        | Purpose                                                 |
| ---------------------------------------------- | ------------------------------------------------------- |
| `lumpscode setup`                              | Write an initial config for your provider               |
| `lumpscode doctor`                             | Check config, providers, permissions, instruction files |
| `lumpscode run "<task>"`                       | Run a task non-interactively and stream the result      |
| `lumpscode run "<task>" --verify`              | Baseline tests first, fail only on new test failures    |
| `lumpscode serve`                              | Serve the HTTP API with SSE streaming                   |
| `lumpscode gateway`                            | Serve tasks from Telegram                               |
| `lumpscode cron add\|list\|remove\|run\|start` | Scheduled unattended tasks                              |
| `lumpscode mcp add\|list\|remove\|call`        | Manage MCP servers and call their tools                 |
| `lumpscode mcp serve`                          | Expose lumpscode tools as an MCP server over stdio      |
| `lumpscode acp`                                | Speak Agent Client Protocol over stdio for editors      |
| `lumpscode update`                             | Check for a newer release                               |

See [PRD.md](../PRD.md) for the product spec and [SECURITY.md](../SECURITY.md) for the trust model.
