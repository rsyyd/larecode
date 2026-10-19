# Lare Code

Lare Code is an open-source, provider-neutral AI coding agent for the terminal. This folder is the documentation site source, published with GitHub Pages.

| Page                                                               | What it covers                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| [getting-started.md](getting-started.md)                           | Install, first run, config location                        |
| [configuration.md](configuration.md)                               | Global and project config, environment variables           |
| [providers.md](providers.md)                                       | OpenAI-compatible, Anthropic, Ollama, and custom providers |
| [permissions.md](permissions.md)                                   | Permission groups, modes, unattended flows, audit log      |
| [tools.md](tools.md)                                               | Built-in tools and how they map to permission groups       |
| [mcp.md](mcp.md)                                                   | MCP client config and `larecode mcp serve` server mode     |
| [automation.md](automation.md)                                     | HTTP server, share links, cron jobs, Telegram gateway      |
| [sdk.md](sdk.md)                                                   | TypeScript SDK and the ACP adapter for editors             |
| [install.md](install.md)                                           | npm, curl, Homebrew, Scoop, PKGBUILD, manual installs      |
| [architecture/adr/](architecture/adr/0001-desktop-app-deferred.md) | Architecture decision records                              |

## Full command reference

| Command                                       | Purpose                                                 |
| --------------------------------------------- | ------------------------------------------------------- |
| `larecode setup`                              | Write an initial config for your provider               |
| `larecode doctor`                             | Check config, providers, permissions, instruction files |
| `larecode run "<task>"`                       | Run a task non-interactively and stream the result      |
| `larecode run "<task>" --verify`              | Baseline tests first, fail only on new test failures    |
| `larecode serve`                              | Serve the HTTP API with SSE streaming                   |
| `larecode gateway`                            | Serve tasks from Telegram                               |
| `larecode cron add\|list\|remove\|run\|start` | Scheduled unattended tasks                              |
| `larecode mcp add\|list\|remove\|call`        | Manage MCP servers and call their tools                 |
| `larecode mcp serve`                          | Expose larecode tools as an MCP server over stdio       |
| `larecode acp`                                | Speak Agent Client Protocol over stdio for editors      |
| `larecode update`                             | Check for a newer release                               |

See [SECURITY.md](https://github.com/rsyyd/larecode/blob/main/SECURITY.md) for the trust model.
