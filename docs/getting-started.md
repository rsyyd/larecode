# Getting started

## Install

```bash
npm install -g lumpscode                # Node 20+
brew tap rsyyd/lumpscode && brew install lumpscode
curl -fsSL https://raw.githubusercontent.com/rsyyd/lumpscode/main/install.sh | sh
```

See [install.md](install.md) for Scoop, AUR, and manual binary installs.

## First run

```bash
lumpscode setup          # writes ~/.lumpscode/config.json
lumpscode doctor         # verifies config, provider reachability, permissions
lumpscode run "explain this repository"
```

`lumpscode doctor` is the single source of truth about your setup. Every check it prints maps to a config field; fix what it flags before running real tasks.

## Your first task

```bash
lumpscode run "find the slowest test and explain why it is slow"
```

The run streams output to stdout, then prints token and cost totals. To gate a change on tests:

```bash
lumpscode run "fix the failing parser test" --verify
```

With `--verify`, lumpscode records a baseline of your test failures first, applies changes, re-runs the tests, and fails only if new failures appeared.

## Where things live

| Path                        | What it is                      |
| --------------------------- | ------------------------------- |
| `~/.lumpscode/config.json`  | Global config (0600)            |
| `./lumpscode.json`          | Project overrides               |
| `~/.lumpscode/sessions/`    | Conversation sessions           |
| `~/.lumpscode/jobs.json`    | Cron jobs (0600)                |
| `~/.lumpscode/shares.json`  | Share links (0600)              |
| `~/.lumpscode/gateway.json` | Gateway chat sessions (0600)    |
| `~/.lumpscode/consent.json` | Instruction file consent hashes |

Next: [configuration.md](configuration.md) for the full config reference, [permissions.md](permissions.md) for the trust model.
