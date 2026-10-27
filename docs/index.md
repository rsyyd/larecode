---
title: Lare Code
layout: home
nav_order: 1
description: Open-source, provider-neutral AI coding agent for the terminal
---

<div class="hero">
  <h1>A coding agent that asks before it acts.</h1>
  <p class="hero-tagline">
    Lare Code runs in your terminal, works with the provider you already use,
    and keeps every decision on your machine. Every tool call passes a
    permission gate first; nothing runs, reads, or writes without your say-so.
  </p>
  <div class="hero-actions">
    <span class="install-chip"><span class="chip-dollar">$</span> npm install -g larecode</span>
    <a class="btn-landing btn-primary" href="{{ '/getting-started.html' | relative_url }}">Get started</a>
    <a class="btn-landing btn-secondary" href="https://github.com/rsyyd/larecode">GitHub</a>
  </div>
  <p class="hero-hint">Open source, MIT. No telemetry, no account, no cloud. Works with OpenAI-compatible endpoints, Anthropic, Ollama, OpenRouter, and custom providers.</p>
</div>

## Watch it work

<div class="video-frame">
  <video controls muted playsinline preload="metadata" poster="{{ '/assets/demo-poster.jpg' | relative_url }}" aria-label="Lare Code demo: a terminal session where the agent asks for permission before running a command">
    <source src="{{ '/assets/demo.mp4' | relative_url }}" type="video/mp4" />
    Your browser cannot play this video. The transcript below covers the same session.
  </video>
</div>

The recording is a real session with the released CLI. The model behind it is a local stub, so the demo regenerates without an API key. When the agent wants to run a command, the permission gate asks first; the `y` that follows is a decision, not a formality.

<details markdown="1">
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

## Why people pick it up

<ul class="cards">
  <li class="card">
    <h3>Permission gate, not rubber stamp</h3>
    <p>Tool calls map to groups, the default is deny, destructive operations always need your confirmation, and every decision lands in a tamper-evident audit log.</p>
  </li>
  <li class="card">
    <h3>Bring your own provider</h3>
    <p>OpenAI-compatible, Anthropic, Ollama, OpenRouter, Z.ai, or your own endpoint, with per-run <code>--provider</code> and <code>--model</code> overrides and explicit fallback chains.</p>
  </li>
  <li class="card">
    <h3>Local first</h3>
    <p>Sessions, memory, metrics, and the audit log stay on the device. No telemetry, no accounts, and no cloud sync to opt out of.</p>
  </li>
  <li class="card">
    <h3>Automate without losing control</h3>
    <p>An HTTP API, share links, cron jobs, and a Telegram gateway run under the same permission policy as your interactive turns.</p>
  </li>
</ul>

## Quick start

```bash
npm install -g larecode
larecode setup
larecode doctor
larecode run "explain this repository"
```

`setup` writes `~/.larecode/config.json`, `doctor` checks the config and the provider, and `run` streams one task with token and cost totals. Other install options, including Homebrew, Scoop, and a curl installer, are on the [install options]({{ '/install.html' | relative_url }}) page.

<div class="landing-links" markdown="1">

## Documentation

**Learn**

- [Getting started]({{ '/getting-started.html' | relative_url }}): install, first run, where things live
- [Install options]({{ '/install.html' | relative_url }}): npm, curl, Homebrew, Scoop, PKGBUILD, manual
- [Configuration]({{ '/configuration.html' | relative_url }}): config files, backends, environment variables

**Use**

- [Providers]({{ '/providers.html' | relative_url }}) · [Permissions]({{ '/permissions.html' | relative_url }}) · [Tools]({{ '/tools.html' | relative_url }}) · [TUI]({{ '/tui.html' | relative_url }})
- [MCP]({{ '/mcp.html' | relative_url }}) · [Extensions]({{ '/extensions.html' | relative_url }}) · [Automation]({{ '/automation.html' | relative_url }}) · [SDK and editors]({{ '/sdk.html' | relative_url }})

**Reference**

- [CLI]({{ '/cli.html' | relative_url }}) · [Observability]({{ '/observability.html' | relative_url }}) · [Troubleshooting]({{ '/troubleshooting.html' | relative_url }})
- [Testing]({{ '/testing.html' | relative_url }}) · [Dependency policy]({{ '/dependencies.html' | relative_url }}) · [Release checklist]({{ '/release.html' | relative_url }})
- [Architecture]({{ '/architecture.html' | relative_url }}) · [Claims and evidence]({{ '/claims.html' | relative_url }}) · [Roadmap]({{ '/roadmap.html' | relative_url }})

</div>

It is an early release (0.4.0); there are sharp edges and the [roadmap]({{ '/roadmap.html' | relative_url }}) says what changes next. See the [security policy](https://github.com/rsyyd/larecode/blob/main/SECURITY.md) for what larecode guards and what it does not.
