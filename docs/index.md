---
title: Lare Code
layout: home
nav_order: 1
description: Open-source, provider-neutral AI coding agent for the terminal
---

# Lare Code

Lare Code is an open-source AI coding agent for the terminal. It runs on your machine, works with any OpenAI-compatible provider, and checks every tool call against a permission policy before it runs.

## Quick start

```bash
npm install -g larecode
larecode setup
larecode doctor
larecode run "explain this repository"
```

Other install options, including Homebrew, Scoop, and a curl installer, are on the [install options](install.md) page.

## Documentation

**Start here**

- [Getting started](getting-started.md): install, first run, and where things live
- [Install options](install.md): npm, curl, Homebrew, Scoop, PKGBUILD, manual
- [Configuration](configuration.md): config files, execution backends, environment variables

**Guides**

- [Providers](providers.md): OpenAI-compatible, Anthropic, Ollama, OpenRouter, custom
- [Permissions](permissions.md): groups, modes, unattended flows, audit log
- [Tools](tools.md): built-in tools and their permission groups
- [MCP](mcp.md): client and server modes
- [Automation](automation.md): HTTP server, share links, cron, Telegram gateway
- [SDK and editors](sdk.md): `@larecode/sdk` and the ACP adapter

**Reference**

- [Product requirements](PRD.md): roadmap, release gates, and the 280-task backlog
- [CLI reference](cli.md): every command and option
- [Testing](testing.md): test layers, commands, and CI gates
- [Troubleshooting](troubleshooting.md): fix provider, permission, and session errors
- [Release checklist](release.md): version bump, smoke test, tag, and rollback
- [README claims](claims.md): every public claim and the test behind it
- [Surface contract](architecture/surfaces.md): start, stream, cancel, stop, and status per surface
- [ADR-0001: Desktop app deferred](architecture/adr/0001-desktop-app-deferred.md): why v1 ends at the CLI
- [ADR-0002: Agent runtime contract](architecture/adr/0002-agent-runtime-contract.md): one runtime for every surface

See the [security policy and trust model](https://github.com/rsyyd/larecode/blob/main/SECURITY.md) for what larecode guards and what it does not.
