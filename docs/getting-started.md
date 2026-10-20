---
title: Getting started
nav_order: 2
has_children: true
description: Install larecode, run your first task, and find where things live
---

# Getting started

Install larecode, verify your setup, and run your first task.

## Prerequisites

- A terminal on Linux, macOS, or Windows.
- Node 20+ if you install through npm. The curl installer, Homebrew, and Scoop need nothing else.
- An endpoint and API key for a provider. Local Ollama works too.

## Install

```bash
npm install -g larecode                # Node 20+
brew tap rsyyd/larecode && brew install larecode
curl -fsSL https://raw.githubusercontent.com/rsyyd/larecode/main/install.sh | sh
```

See [install options](install.md) for Scoop, PKGBUILD, and manual binary installs.

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

## Next steps

- [Configuration](configuration.md) for the full config reference.
- [Permissions](permissions.md) for the trust model and unattended flows.
