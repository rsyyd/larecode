---
title: Lare Code
layout: home
nav_order: 1
description: Open-source, provider-neutral AI coding agent for the terminal
---

# Lare Code

Lare Code is a coding agent that lives in your terminal. Point it at the provider you already use, anything OpenAI-compatible plus Anthropic, Ollama, OpenRouter, or your own endpoint, and it reads, edits, and runs your code under a permission policy you control.

The permission policy is the point. Every tool call maps to a group, the default is deny, and destructive operations always need a confirmation from you. Each decision lands in a local audit log that `larecode audit` can verify. Nothing leaves the machine: no telemetry, no account, no cloud.

It is an early release (0.3.0). There are sharp edges; the [roadmap](roadmap.md) says what changes next.

## Demo

<video controls muted playsinline preload="metadata" width="960" height="540" poster="/assets/demo-poster.jpg" aria-label="Lare Code demo: a terminal session where the agent asks for permission before running a command">
  <source src="/assets/demo.mp4" type="video/mp4" />
  Your browser cannot play this video. The transcript below covers the same session.
</video>

The recording is a real session with the released CLI. The model behind it is a local stub, so the demo regenerates without an API key. When the agent wants to run a command, the permission gate asks first; the `y` that follows is a decision, not a formality.

<details>
<summary>Transcript</summary>

```console
› summarize this repository

Let me look at the repository first.

⎿ bash · ls
  permission: shell · bash · y/n
  ls
  y allow  n deny

✓ bash · ls

This is Lare Code, a coding agent that runs in your terminal and asks before it
acts.

- packages/core holds the agent loop, the tools, and the permission engine
- packages/cli and packages/tui provide the commands and the interface
- local first: no telemetry, no accounts

Every tool call passes the permission gate you just approved.

Get started:

  larecode setup
  larecode doctor

Docs: rsyyd.github.io/larecode
```

</details>

Regenerate the recording with `bun run demo`; `sh demo/render.sh` rebuilds the video with [HyperFrames](https://github.com/heygen-com/hyperframes).

## Quick start

```bash
npm install -g larecode
larecode setup
larecode doctor
larecode run "explain this repository"
```

`setup` writes `~/.larecode/config.json`, `doctor` checks the config and the provider, and `run` streams one task with token and cost totals. Other install options, including Homebrew, Scoop, and a curl installer, are on the [install options](install.md) page.

## Documentation

**Start here**

- [Getting started](getting-started.md): install, first run, and where things live
- [Install options](install.md): npm, curl, Homebrew, Scoop, PKGBUILD, manual
- [Configuration](configuration.md): config files, execution backends, environment variables

**Guides**

- [Providers](providers.md): OpenAI-compatible, Anthropic, Ollama, OpenRouter, custom
- [TUI](tui.md): keys, slash commands, terminal support
- [Permissions](permissions.md): groups, modes, unattended flows, audit log
- [Tools](tools.md): built-in tools and their permission groups
- [MCP](mcp.md): client and server modes
- [Extensions](extensions.md): skills, subagents, and plugins
- [Automation](automation.md): HTTP server, share links, cron, Telegram gateway
- [SDK and editors](sdk.md): `@larecode/sdk` and the ACP adapter

**Reference**

- [CLI reference](cli.md): every command and option
- [Testing](testing.md): test layers, commands, and CI gates
- [Observability](observability.md): usage, metrics, debug bundles, audit log
- [Dependency policy](dependencies.md): cadence, audits, and advisories
- [Troubleshooting](troubleshooting.md): fix provider, permission, and session errors
- [Release checklist](release.md): version bump, smoke test, tag, and rollback
- [0.3.0 audit](audit-0.3.0.md): P0/P1 review and sign-off for this release
- [README claims](claims.md): every public claim and the test behind it
- [Surface contract](architecture/surfaces.md): start, stream, cancel, stop, and status per surface
- [ADR-0001: Desktop app deferred](architecture/adr/0001-desktop-app-deferred.md): why v1 ends at the CLI
- [ADR-0002: Agent runtime contract](architecture/adr/0002-agent-runtime-contract.md): one runtime for every surface

See the [security policy and trust model](https://github.com/rsyyd/larecode/blob/main/SECURITY.md) for what larecode guards and what it does not.
