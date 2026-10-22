# Examples

Small, copyable configurations. All files are plain JSON; merge the keys you need into `~/.larecode/config.json` (global) or `larecode.json` (project).

| File                    | What it shows                              |
| ----------------------- | ------------------------------------------ |
| `ollama-local.json`     | Fully local provider, no API key           |
| `fallback-chain.json`   | Explicit primary → fallback chain          |
| `mcp-playwright.json`   | MCP server for browser checks              |
| `cron-nightly-tests.md` | Scheduled unattended test run with retries |

## Verify before relying on them

```bash
larecode doctor
larecode run --json "reply with OK"
```

`doctor` checks auth, reachability, model presence, and streaming per model, and prints a suggestion for each problem it finds.
