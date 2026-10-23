---
title: Configuration
parent: Getting started
nav_order: 2
description: Config files, execution backends, environment variables, and instruction files
---

# Configuration

Lare Code reads two config files and merges them, with the project file winning:

| File                      | Scope                            |
| ------------------------- | -------------------------------- |
| `~/.larecode/config.json` | Global defaults for your machine |
| `./larecode.json`         | Per-project overrides            |

Set `LARECODE_HOME` to move the global directory (used by tests and sandboxes).

## Global config shape

```json
{
  "version": "0.3.0",
  "defaultProvider": "openai-compatible",
  "defaultModel": "gpt-4o",
  "permissions": { "mode": "ask", "allowedGroups": ["read"] },
  "providers": {
    "openai-compatible": {
      "type": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "models": ["gpt-4o", "gpt-4o-mini"]
    }
  },
  "mcpServers": {},
  "execution": { "backend": "local" },
  "checkpoints": false,
  "locale": "en"
}
```

The `version` field tracks the CLI that wrote the file. The config file is written with `0600` permissions. `larecode setup` creates a valid starting point:

```bash
larecode setup --provider openai --base-url https://api.openai.com/v1 --api-key sk-... --model gpt-4o
```

`locale` sets the interface language for first-run and setup messages, `en` (default) or `id` for Indonesian. `LARECODE_LOCALE` overrides it for one command. The agent's tools and the TUI chat surface stay in English.

It refuses to overwrite an existing config unless you pass `--force`.

## Execution backends

| Backend  | Config                                                                   |
| -------- | ------------------------------------------------------------------------ |
| `local`  | none                                                                     |
| `docker` | `{"backend": "docker", "docker": {"image": "alpine", "network": false}}` |
| `ssh`    | `{"backend": "ssh", "ssh": {"host": "devbox", "user": "me"}}`            |

Docker runs with `--network none` unless you set `"network": true`. SSH uses batch mode and non-interactive auth (keys only). `larecode doctor` validates the shape of whichever backend you pick.

## Checkpoints

Set `"checkpoints": true` to record a git-backed snapshot of the workspace before and after every tool call. Snapshots live under `~/.larecode/checkpoints` and stay per session. Off by default; it needs `git` on `PATH` and adds a git add/index pass to every tool call. A failed checkpoint logs a warning and never fails the turn.

## Environment variables

| Variable                     | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `LARECODE_HOME`              | Global config directory (default `~/.larecode`)      |
| `LARECODE_LOG_LEVEL`         | `debug`, `info`, `warn`, `error`                     |
| `LARECODE_SERVER_TOKEN`      | Bearer token for `larecode serve`                    |
| `LARECODE_TELEGRAM_TOKEN`    | Bot token for `larecode gateway`                     |
| `LARECODE_TELEGRAM_CHAT_ID`  | Restrict the gateway to one chat                     |
| `LARECODE_TELEGRAM_API_BASE` | Telegram API base URL (testing or self-hosted proxy) |

## Instruction files

On startup the context builder looks for instruction files in the project, in this order: `AGENTS.md`, `LARECODE.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`. A new or changed file is treated as untrusted input until you consent to it; consent hashes live in `~/.larecode/consent.json`. `larecode doctor` reports any pending or changed files.
