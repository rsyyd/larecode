# Getting started

## Install

```bash
npm install -g larecode                # Node 20+
brew tap rsyyd/lare && brew install larecode
curl -fsSL https://raw.githubusercontent.com/rsyyd/lare/main/install.sh | sh
```

See [install.md](install.md) for Scoop, AUR, and manual binary installs.

## First run

```bash
larecode setup          # writes ~/.larecode/config.json
larecode doctor         # verifies config, provider reachability, permissions
larecode run "explain this repository"
```

`larecode doctor` is the single source of truth about your setup. Every check it prints maps to a config field; fix what it flags before running real tasks.

## Your first task

```bash
larecode run "find the slowest test and explain why it is slow"
```

The run streams output to stdout, then prints token and cost totals. To gate a change on tests:

```bash
larecode run "fix the failing parser test" --verify
```

With `--verify`, larecode records a baseline of your test failures first, applies changes, re-runs the tests, and fails only if new failures appeared.

## Where things live

| Path                       | What it is                      |
| -------------------------- | ------------------------------- |
| `~/.larecode/config.json`  | Global config (0600)            |
| `./larecode.json`          | Project overrides               |
| `~/.larecode/sessions/`    | Conversation sessions           |
| `~/.larecode/jobs.json`    | Cron jobs (0600)                |
| `~/.larecode/shares.json`  | Share links (0600)              |
| `~/.larecode/gateway.json` | Gateway chat sessions (0600)    |
| `~/.larecode/consent.json` | Instruction file consent hashes |

Next: [configuration.md](configuration.md) for the full config reference, [permissions.md](permissions.md) for the trust model.
