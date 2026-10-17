# Lumps Code — Product Requirements Document

**Repo:** `github.com/rsyyd/lumpscode`
**Version:** 1.0.0-draft · **Date:** 2026-10-17 · **Status:** PRD stage · **License:** MIT

---

## 1. Executive Summary

Lumps Code is an open-source, provider-neutral AI coding agent for the terminal. Its goal is simple and ambitious: **combine the proven advantages of every leading coding agent CLI — opencode, Claude Code, Codex CLI, Gemini CLI, and Hermes Agent — into one coherent, local-first CLI**, while keeping the architecture small enough that each capability can be built, tested, and shipped independently.

This document is the complete product specification. Implementation is deliberately broken into **32 independently executable tasks** (Section 9): each task is scoped to be completed by a single focused AI session or engineer, with explicit dependencies and acceptance criteria. Nothing is built "all at once."

## 2. Vision & Positioning

> **"Every agent's best, in one CLI."**

- One binary: `lumpscode`. Config: `~/.lumpscode/`. Project instructions: `AGENTS.md` (compatible with `CLAUDE.md` & friends).
- **Local-first, no lock-in:** any model — OpenAI-compatible endpoints, Anthropic, Google, Ollama, OpenRouter, Z.ai/GLM, or a custom base URL.
- **Full parity goal:** TUI, plan mode, subagents, skills, plugins, hooks, MCP, LSP, learning loop, session sharing, cron automation, and a multi-platform gateway.
- **Safety by default:** every tool call is permission-checked; destructive and secret access is never auto-approved.

What would make this a failure even if it works (anti-goals):

- One monolithic core where every feature lives inside the agent loop (the Hermes AGENTS.md calls this the "narrow waist" — we adopt the same rule).
- Telemetry or data egress without explicit opt-in.
- Breaking per-conversation prompt caching (cost discipline inherited from Hermes).

## 3. Competitive Analysis

| Capability | opencode | Claude Code | Codex CLI | Gemini CLI | Hermes | **Lumps Code** |
|---|---|---|---|---|---|---|
| Full TUI (multiline, autocomplete, streaming) | ✅ | ➖ (read-line) | ➖ | ➖ | ✅ | ✅ T-10 |
| Plan mode (read-only agent, Tab switch) | ✅ | ✅ | ✅ | ✅ | ➖ | ✅ T-15 |
| Subagents (parallel research) | ✅ `@general` | ✅ Task tool | ➖ | ➖ | ✅ | ✅ T-15 |
| Permission engine (grouped, policy-scoped) | ✅ | ✅ | ✅ sandbox | ✅ | ➖ (light) | ✅ T-09 |
| Multi-provider (75+, catalog) | ✅ | Anthropic only | OpenAI | Google | ✅ | ✅ T-04/05 |
| LSP integration | ✅ | ➖ | ➖ | ➖ | ➖ | ✅ T-13 |
| MCP client + server | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ T-14 |
| Skills (auto-load, SKILL.md) | ➖ | ✅ | ➖ | ✅ | ✅ | ✅ T-16 |
| Hooks / plugins | ➖ plugins | ✅ hooks | ➖ | ➖ | ✅ plugins | ✅ T-17 |
| Learning loop (curated memory, auto-skills) | ➖ | ➖ | ➖ | ➖ | ✅ | ✅ T-22 |
| Session sharing / HTTP server | ✅ share | ➖ | ➖ | ➖ | ➖ | ✅ T-23/24 |
| Cron / scheduled automations | ➖ | ➖ | ➖ | ➖ | ✅ | ✅ T-25 |
| Messaging gateway (Telegram/Slack/…) | ➖ | ➖ | ➖ | ➖ | ✅ ~20 | ✅ T-26 |
| Execution backends (Docker/SSH/sandbox) | ➖ | ➖ | ✅ | ✅ | ✅ 7 | ✅ T-27 |
| Checkpoints / rewind | ➖ | ✅ | ➖ | ➖ | ✅ | ✅ T-20 |
| Cost/usage tracking, per-conversation caching | partial | ✅ | ➖ | ➖ | ✅ | ✅ T-28 |

Sources: opencode README/docs (fetched 2026-10-17), Hermes Agent README + AGENTS.md (local checkout), known public feature sets of Claude Code / Codex CLI / Gemini CLI.

## 4. Target Users & Use Cases

1. **Individual developer** — daily coding companion in the terminal: plan, edit, test, commit, explain.
2. **Privacy-conscious / local-first user** — Ollama or self-hosted gateway; data never leaves the machine.
3. **Power user / automator** — cron jobs ("nightly audit, report to Telegram"), background tasks, gateway access from phone.
4. **Team** — shareable session links for review; `AGENTS.md` conventions; consistent permission policies via repo config.

## 5. Goals / Non-Goals

**Goals (v1.0):** all capabilities in Section 6 shipped through milestones M0–M4; installable via one curl/npm command; MIT-licensed; every task CI-tested.

**Non-Goals (v1.0):** desktop app (M4 stretch), voice I/O, own model training, mobile clients, hosted SaaS, **multi-user gateway tenancy, and a public hosted share-link frontend** (share links render from self-hosted `lumpscode serve` only). The PRD ends at the CLI + gateway + share links; everything else is future work.

## 6. Functional Requirements

### FR-1 Agent Runtime
Bounded iterations; tool-call limits; repetition detection; token/duration budgets; cancellation; streamed output; per-turn usage accounting; **per-conversation prompt caching is sacred** — history is never mutated mid-conversation, with exactly two accepted exceptions: explicit compaction, and an explicit user-initiated agent mode switch (`Tab`).

### FR-2 TUI
Full-screen terminal UI (Ink/React): multiline editing, slash-command palette with autocomplete, conversation history, interrupt-and-redirect, streaming tool output, theming, keybindings, `Tab` agent switch. See Appendix A for screen mockups.

### FR-3 Providers
Adapters: OpenAI-compatible, Anthropic, Google, Ollama, OpenRouter, Z.ai/GLM, custom `baseUrl`; shared model catalog (models.dev-style) with capability metadata (tools/vision/reasoning); hot-swap via `/model`; reasoning-profile fallbacks.

### FR-4 Permission Engine
Groups: `read`, `write`, `shell`, `network`, `git`, `secrets`, `destructive`, `external-services`, `subagent`, `browser`, `skills`; modes `ask`/`allow`/`deny`; policy-scoped auto-approval that **never** covers destructive or secrets; **unattended flows (`run`, cron, gateway) default-deny** every group not pre-authorized via an explicit policy bundle at scheduling/connect time — `destructive` and `secrets` are never pre-authorizable; audit log; model output and instruction files can never grant permissions.

### FR-5 Tools
File read/write/edit, glob, grep, bash (shell-safety screening), patch apply (SHA-256 conflict detection), web fetch/search, browser via CDP (capability-scoped).

### FR-6 LSP
Definitions, references, symbols, hover; graceful degradation when no language server is installed.

### FR-7 MCP
Client over stdio + HTTP/SSE; `mcp add/list/remove/call`; every MCP call permission-gated; act as MCP server for other tools (M4).

### FR-8 Skills
`SKILL.md` (agentskills.io-compatible frontmatter); discovery from project/user/global dirs; integrity hashes; optional out-of-process execution.

### FR-9 Plugins & Hooks
Lifecycle hooks (pre/post tool call, session start/end); plugin trust classes with provenance; untrusted-class plugins execute **out-of-process via IPC** — the "can never patch core" guarantee is enforced by process isolation, not convention; in-process execution is opt-in for the signed/user-installed trusted class only.

### FR-10 Subagents & Plan Mode
Built-in `build` (full access) and `plan` (read-only, asks before bash) agents; `@general` research subagent; depth/concurrency/token limits, cancellation propagation, compressed results.

### FR-11 Sessions & Memory
Persisted sessions, resume, compaction; four-tier memory (temporary / session / project / user) with size budgets and secret redaction.

### FR-12 Learning Loop (Hermes-style)
Memory curator with periodic nudges; automatic skill creation after complex tasks — auto-created skills land in a **draft** state and require one-time human confirmation before first execution, and every skill execution is permission-checked like a tool (`skills` group); skills self-improve during use; FTS cross-session search with LLM summarization.

### FR-13 Server & Sharing
`lumpscode serve`: bearer-authenticated, scope-isolated HTTP API with SSE; share links render a session read-only replay.

### FR-14 Automation
Natural-language cron jobs, background tasks, delivery to any connected platform.

### FR-15 Messaging Gateway
Single gateway process serving Telegram first, then Discord/Slack/WhatsApp/Signal; conversation continuity across platforms. **Single-owner trust boundary in v1:** the human on the other end is the device owner; multi-user tenancy is out of scope (see Non-Goals).

### FR-16 Execution Backends
Local default; Docker and SSH backends for isolated/unattended work.

### FR-17 Context Engine
File indexing with relevance ranking; instruction files (`AGENTS.md`, `CLAUDE.md`, `LUMPCODE.md`, `.cursorrules`, `.github/copilot-instructions.md`) loaded with consent, hash-bound trust, and size budgets.

### FR-18 Checkpoints & Worktrees
Conversation/workspace rewind; git worktree management for parallel tasks.

### FR-19 Git/GitHub
Status/diff/commit (permissioned), PR & CI inspection; remote writes require explicit authorization.

### FR-20 Distribution & UX
`lumpscode setup` / `doctor` / `update`; usage & cost display; install via npm, curl script, Homebrew, Scoop, pacman/AUR.

## 7. Non-Functional Requirements

- **Startup:** < 100 ms to first paint (benchmark in CI).
- **Language/runtime:** TypeScript strict, ESM. **Bun is the only CLI runtime:** distributions ship as `bun build --compile` binaries plus a Bun-based npm package — no Node requirement for users. The SDK (T-30) is pure TypeScript with zero Bun-specific APIs so it runs under Node ≥ 20. **Support tiers:** Tier 1 — Linux x64/arm64, macOS; Tier 2 (best-effort) — Windows (CLI + TUI work; Docker/SSH backends recommend WSL).
- **Tests:** Vitest; behavior-contract tests per module; every task ships with tests.
- **Security:** untrusted = model output, plugins, instruction files; **secrets are never persisted in plaintext** — redact-on-persist in transcripts/logs, and share links render the redacted form; config written `0600`.
- **Privacy:** zero telemetry; any usage reporting is opt-in.
- **Cost:** per-conversation token/cost accounting surfaced in TUI.

## 8. Architecture Overview

```
lumpscode/                     (monorepo, Bun workspaces)
├── packages/core/             agent loop, providers, tools, permissions,
│                              sessions, memory, context, LSP, MCP client
├── packages/tui/              Ink/React terminal UI (client of core)
├── packages/cli/              entrypoint, commands (setup/doctor/run/serve/…)
├── packages/server/           HTTP API + SSE + share links
├── packages/gateway/          messaging platform adapters
├── packages/sdk/              TypeScript SDK for embedding lumpscode
└── packages/skills/           built-in skills (shipped, not all active)
```

Client/server model: TUI and gateway are clients of the same core agent; `serve` exposes the core over HTTP — identical architecture lesson taken from opencode and Hermes.

## 9. Execution Model — Task Splitting Rules (Mandatory)

> This is the core operating rule requested by the product owner: **tasks are split so that no AI process attempts the whole build at once.**

1. **One task = one AI session/process.** A task is a self-contained unit: its own context, its own branch, its own tests. Never bundle multiple tasks into one session.
2. **A task is done only when** lint + typecheck + tests pass in CI, docs/CHANGELOG updated, and the acceptance criteria are demonstrably met.
3. **If a task overflows one session**, stop, commit the working state, and split the remainder into a new task — do not silently continue.
4. **Dependencies are hard:** a task starts only when its dependency tasks are merged.
5. Each task below states: **Scope / Depends on / Acceptance**.

### M0 — Foundation

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| T-01 | Monorepo scaffold: Bun workspaces, TS strict, oxlint+prettier, vitest, GitHub Actions CI, MIT LICENSE, README | — | `bun test` green in CI; hello-world binary runs |
| T-02 | Config system: `~/.lumpscode/config.json`, project `lumpscode.json`, instruction-file discovery & consent | T-01 | `lumpscode doctor` validates config, prints provider/permission state |
| T-03 | Logging, error taxonomy, usage accounting skeleton | T-01 | structured logs, error codes, usage recorder API |

### M1 — Core Agent MVP

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| T-04 | Provider abstraction + OpenAI-compatible adapter + model catalog | T-02 | scripted chat round-trip against mock server; model hot-swap |
| T-05 | Anthropic, Ollama, OpenRouter, Z.ai adapters + capability metadata | T-04 | all adapters pass shared contract tests |
| T-06 | Agent loop: budgets, bounded iterations, cancellation, streaming | T-03, T-04 | loop halts on budget; streamed tokens observed in test |
| T-07 | Tool framework: registry, JSON-schema defs, execution pipeline | T-06 | a dummy tool registered, called, logged |
| T-08 | Core tools: read, write, edit, bash, glob, grep, patch (SHA-256 conflicts) | T-07 | contract tests incl. patch-conflict rejection |
| T-09 | Permission engine: groups, modes, policy scoping, audit log, redaction | T-08 | destructive/secrets never auto-approved; audit entries written |
| T-10 | TUI v1: chat, streaming, multiline input, slash palette, themes | T-06 | manual + snapshot tests; startup < 100 ms |
| T-11 | Session persistence & resume | T-06 | resume reproduces context; secrets redacted on disk |
| T-12 | Non-interactive `lumpscode run "task"` + `--verify` (baseline-aware test check) | T-08, T-11 | run mode passes/fails per pre-existing-baseline logic |

### M2 — Intelligence & Extensibility

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| T-13 | LSP client (defs/refs/symbols/hover, graceful degrade) | T-07 | LSP-backed symbol lookup in test repo |
| T-14 | MCP client (stdio+HTTP) + `mcp` commands | T-09 | call a reference MCP server; permission gate enforced |
| T-15 | Plan mode + subagents (`build`/`plan` Tab switch, `@general`) | T-10, T-08 | plan agent cannot write; subagent returns compressed result |
| T-16 | Skills system (SKILL.md, discovery, integrity, agentskills.io compat) | T-07 | skill loads, triggers, executes; bad hash rejected |
| T-17 | Hooks + plugins (lifecycle hooks, trust classes) | T-07 | pre-tool hook blocks a call in test |
| T-18 | Context engine (indexing, relevance ranking, instruction budgets) | T-08 | ranked file hits within budget |
| T-19 | Four-tier memory (temp/session/project/user) | T-11 | tier scoping + redaction tests |
| T-20 | Checkpoints/rewind + git worktrees | T-11, T-08 | rewind restores workspace state |
| T-21 | Web fetch/search + browser (CDP, capability-scoped) | T-09 | fetch tool respects network permission group |

### M3 — Differentiators

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| T-22 | Learning loop: memory curator, auto-skill creation, FTS cross-session search | T-16, T-19 | complex task produces a persisted skill; search returns summarized history |
| T-23 | `lumpscode serve`: HTTP API + SSE, bearer auth, scope isolation | T-06 | SDK-less curl drives a session end-to-end |
| T-24 | Session share links (read-only replay) | T-23 | link renders full session without leaking secrets |
| T-25 | Cron automations + background tasks | T-23 | scheduled job runs unattended, reports result |
| T-26 | Messaging gateway: Telegram first, then Discord/Slack | T-23 | send task from Telegram, receive result |
| T-27 | Execution backends: Docker, SSH | T-12 | bash tool routes through Docker backend in test |
| T-28 | Usage/cost tracking + `doctor`/`update` hardening | T-03 | per-conversation cost shown in TUI |

### M4 — Polish & Distribution

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| T-29 | Distribution: npm package, curl installer, Homebrew, Scoop, pacman/AUR | M1 | fresh-machine install to first prompt < 60 s |
| T-30 | TypeScript SDK + ACP adapter (editor/IDE integration) | T-23 | SDK drives core in integration test |
| T-31 | Docs site + SECURITY.md pass + MCP-server mode | all | full docs; boundary review done |
| T-32 | Desktop app (stretch) | T-23 | out of scope if M4 overruns |

## 10. Success Metrics

- `curl … | bash` → first AI response in **< 60 s** on a fresh machine.
- Startup **< 100 ms**; TUI stays responsive during streaming.
- One-command provider/model switch with zero code changes.
- Every merged task green in CI; no task exceeds one focused session without being split.
- Community signals: stars/contributors tracking against opencode's trajectory (214k stars reference).

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Scope creep ("all features of everything") | Hard milestone gates; Section 9 task discipline; one task per session |
| Bun-only distribution limits reach | Compile standalone binaries for linux/macOS/win via `bun build --compile` |
| TUI complexity sinks the MVP | TUI v1 is chat+streaming only; polish tasks isolated (T-10 acceptance bounded) |
| Security surface (permissions, plugins, MCP) | Default-deny; untrusted-by-default; SECURITY.md boundary review in T-31 |
| Prompt-cache breaks explode cost | FR-1 invariant: never mutate conversation history except compaction |
| Provider drift (75+ models) | Single catalog source + shared contract tests (T-04/05) |

## 12. Open Questions

1. Binary alias `lc` in addition to `lumpscode`?
2. Default reasoning profile for unknown models?
3. Apache-2.0 (predecessor) vs **MIT (default, matches opencode)** — confirm MIT.

---

## 13. Builder-Check Resolutions (PRD-stage calls)

An independent builder review raised nine questions before planning could proceed. Each was resolved at PRD stage and folded into the requirements above. They are **calls, not contracts** — the product owner can override any of them.

| # | Question | Resolution |
|---|---|---|
| 1 | Unattended permission defaults (`run`/cron/gateway) | Default-deny; explicit policy pre-authorization only; `destructive`/`secrets` never pre-authorized (FR-4) |
| 2 | Gateway: single- vs multi-user | Single-owner trust boundary in v1; multi-user tenancy is a non-goal (FR-15, §5) |
| 3 | Bun/Node boundary | Bun-only CLI (compiled binaries + Bun npm package); SDK is pure TS under Node ≥ 20 (§7) |
| 4 | Cache purity vs agent Tab-switching | Mode switch is the second accepted cache-break exception (FR-1) |
| 5 | Secrets at rest | Redact-on-persist, never plaintext; share links render redacted (§7) |
| 6 | Auto-created skill trust chain | Draft state + one-time human confirmation; executions permission-gated (FR-12, FR-4 `skills` group) |
| 7 | Windows support tier | Tier 2 best-effort; Tier 1 = Linux/macOS (§7) |
| 8 | "Never patch core": convention or guarantee? | Enforced by out-of-process IPC for untrusted plugins (FR-9) |
| 9 | Share-link hosting | Self-hosted `serve` render only; public frontend excluded by Non-Goals (§5) |

---

## Appendix A — TUI Mockups (FR-2)

### A.1 First run (no config) — setup wizard

```
╭─────────────────────────────────────────────╮
│  ⚡ Lumps Code v1.0.0                       │
│  Every agent's best, in one CLI.            │
╰─────────────────────────────────────────────╯

  No configuration found — let's set you up.

  [1/3] Pick a provider
    ❯ OpenAI-compatible (custom base URL)
      Anthropic
      Ollama (local)
      OpenRouter
      Z.ai / GLM

  [2/3] Base URL : http://localhost:20128/v1
  [3/3] API key  : ••••••••••

  ✻ doctor: config written to ~/.lumpscode/config.json
```

### A.2 Main screen

```
╭─ lumpscode ──────────────────────────────────╮
│                                              │
│  ● you                                       │
│  refactor the config loader                  │
│                                              │
│  ⏺ lumps · plan                              │
│  Reading src/config.ts…                      │
│                                              │
│  ⏺ lumps · read(2) grep(1)                   │
│  I'll rename loadConfig → loadAppConfig      │
│  across 3 files. Apply in build mode?         │
│                                              │
│ ────────────────────────────────────────────│
│  ❯ type a message…                          │
│                                              │
│  plan (Tab) · gpt-4o · 12.3k tok · $0.02     │
╰──────────────────────────────────────────────╯
```

Screen elements:

- Multiline input at the bottom, streaming output above, full box border (opencode-style).
- `Tab` = switch agent `plan` (read-only) ↔ `build` (full access).
- `/` = command palette (`/model`, `/skill`, `/session`, `/share`); `@general` = invoke research subagent.
- Footer: active mode · model · real-time token/cost counter.
- Interrupt: `Esc` / `ctrl+c` for stop-and-redirect.
- Dark theme by default, themable via `lumpscode.json`.

### A.3 Other modes

- `lumpscode "task"` — plain non-interactive streaming output, then a summary.
- `lumpscode serve` — API banner with host/port and bearer-token hint.
