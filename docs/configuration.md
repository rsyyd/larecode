# Configuration

Lumps Code reads two config files and merges them, with the project file winning:

| File                       | Scope                            |
| -------------------------- | -------------------------------- |
| `~/.lumpscode/config.json` | Global defaults for your machine |
| `./lumpscode.json`         | Per-project overrides            |

Set `LUMPSCODE_HOME` to move the global directory (used by tests and sandboxes).

## Global config shape

```json
{
  "version": "0.0.0",
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
  "execution": { "backend": "local" }
}
```

The config file is written with `0600` permissions. `lumpscode setup` creates a valid starting point:

```bash
lumpscode setup --provider openai --base-url https://api.openai.com/v1 --api-key sk-... --model gpt-4o
```

It refuses to overwrite an existing config unless you pass `--force`.

## Execution backends

| Backend  | Config                                                                   |
| -------- | ------------------------------------------------------------------------ |
| `local`  | none                                                                     |
| `docker` | `{"backend": "docker", "docker": {"image": "alpine", "network": false}}` |
| `ssh`    | `{"backend": "ssh", "ssh": {"host": "devbox", "user": "me"}}`            |

Docker runs with `--network none` unless you set `"network": true`. SSH uses batch mode and non-interactive auth (keys only). `lumpscode doctor` validates the shape of whichever backend you pick.

## Environment variables

| Variable                      | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `LUMPSCODE_HOME`              | Global config directory (default `~/.lumpscode`)     |
| `LUMPSCODE_LOG_LEVEL`         | `debug`, `info`, `warn`, `error`                     |
| `LUMPSCODE_SERVER_TOKEN`      | Bearer token for `lumpscode serve`                   |
| `LUMPSCODE_TELEGRAM_TOKEN`    | Bot token for `lumpscode gateway`                    |
| `LUMPSCODE_TELEGRAM_CHAT_ID`  | Restrict the gateway to one chat                     |
| `LUMPSCODE_TELEGRAM_API_BASE` | Telegram API base URL (testing or self-hosted proxy) |

## Instruction files

On startup the context builder looks for instruction files in the project, in this order: `AGENTS.md`, `LUMPCODE.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`. A new or changed file is treated as untrusted input until you consent to it; consent hashes live in `~/.lumpscode/consent.json`. `lumpscode doctor` reports any pending or changed files.
