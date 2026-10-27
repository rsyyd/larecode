---
title: Troubleshooting
nav_order: 12
description: Fix common configuration, provider, permission, and session errors
---

# Troubleshooting

Start with `larecode doctor`. It checks the config path, provider auth, model catalog, a streaming probe, permissions, and instruction consent.

## Interactive mode needs a terminal

```text
larecode: interactive mode needs a terminal. Use `larecode run "<task>"` instead.
```

`larecode chat` needs a TTY. Use `larecode run "<task>"` in scripts and CI, or wrap the command in `tmux`/`script` when you need the TUI.

## Authentication failed

`PROVIDER_AUTH_FAILED` or HTTP 401/403 means the provider rejected the key.

- Run `larecode setup --force` to rewrite the provider entry, or edit `~/.larecode/config.json`.
- Confirm the key belongs to the same base URL and provider type.
- Some proxies require the key in a different header; use an `openai-compatible` entry with the proxy URL.
- `doctor` fails the auth check before making a streaming request when a remote provider has no key.

## Rate limits and timeouts

- `RATE_LIMITED` (HTTP 429) is retried with backoff before any text is streamed. If it persists, switch provider or model.
- `PROVIDER_TIMEOUT` means one request exceeded its deadline. Raise the model timeout in config or pick a faster model.
- Retries stop once text has been emitted, so a partial answer is never duplicated.

## Model not found

`doctor` and `larecode setup` reject a default model that the provider does not list. Run `larecode doctor` to see the catalog check, then choose a model from `providers.<name>.models` or add it to that list.

## Empty response

`EMPTY_RESPONSE` means the provider finished without text and without a tool call. Check the model name, the request format, and the provider logs. Repeating the same request is safe; the turn is not marked complete.

## Permission denied

A tool call is denied when its permission group is not allowed:

- `ask` mode prompts in the TUI; non-interactive surfaces deny instead of guessing.
- `secrets` and `destructive` are never pre-authorized.
- `serve` uses the caller's token scopes; a `read` token cannot run tools.
- Gateway and cron only allow groups passed with `--allow`.

Change the mode or groups in `~/.larecode/config.json`, or pass the right `--allow` list. The denial is recorded in the audit log.

## Session not found or corrupted

Sessions live under `~/.larecode/sessions`. `SESSION_NOT_FOUND` means the id is wrong or the file was deleted. List ids with `ls ~/.larecode/sessions`, and remove one with `larecode sessions rm <id>`. A corrupted file is skipped with a warning; start a new session.

## MCP server fails to connect

`MCP_CONNECTION_FAILED` covers a missing command, an unreachable URL, and a server that exits during startup.

- `larecode mcp list` shows the configured name and transport.
- For stdio, check the command exists on `PATH` and runs outside larecode.
- For HTTP, check the URL and headers; requests time out after 15 seconds.
- MCP tools require the `external-services` group and explicit confirmation.

## Config is invalid

`doctor` prints every problem and exits non-zero. The global file is `~/.larecode/config.json`; a project can override it with `larecode.json`. Old 0.1 configs are upgraded on load, so missing `allowedGroups`, `mcpServers`, or `execution` fields do not need a manual edit. Run `larecode setup --force` if the file cannot be repaired.

## Windows

Use WSL for the full experience. The npm package also runs on Windows, but the `local` execution backend and terminal keybindings are tested on Linux and macOS first.

## Reporting a bug

Include `larecode --version`, your OS, the failing command, and the exact error. Run `larecode doctor` and redact keys, tokens, and private paths before sharing its output.
