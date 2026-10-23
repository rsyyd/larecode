# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- TUI markdown and fenced code rendering with ANSI stripping; unified diffs are colored and long tool panels compact with a hidden-line count.
- TUI `/search`, `/copy`, and `/export` commands, plus an `@` file picker that skips generated directories.
- TUI `/sessions <query>` filters the session browser by title or id.
- `larecode completion bash|zsh|fish` shell completion.
- `larecode skill author` turns a complex session into a draft skill; draft skills stay out of the catalog until marked active, and `state: disabled` skills are skipped.
- `larecode skill install` copies community skills from a git URL or local directory, and `larecode skill list` shows the catalog with approval status.
- Opt-in smoke runs: `bun run test:live` for a real provider request and `bun run test:lsp` against a local `clangd`; a manual **Live smoke** GitHub workflow reads provider secrets.

## [0.3.0] - 2026-10-22

### Added

- Smart context assembly: workspace index, repository map, lexical/structural retrieval, multi-tier memory, token budgeting, and secret sanitization. `larecode context` and `/context` show what was injected.
- `evaluateRetrieval` and a fixture corpus measure retrieval recall, so context quality is tested rather than assumed.
- Compaction preserves recent tool calls and reports what it dropped.
- Read-only tool calls run in parallel with a serial fallback when a call needs an exclusive lock.
- Explicit provider fallback chains, `contextWindow` capability metadata, and token calibration per model.
- `larecode doctor` now checks each configured model, supports `--json`, and suggests a fix for common failures.
- TUI prompt queue, `/status`, `/sessions`, `/new`, a model picker that marks unavailable models, and restored history on resume.
- Runtime metrics, local usage summary, redacted debug bundles, crash reports, and `larecode feedback` with secret redaction.
- Hash-chained tool audit log with `larecode audit --verify`, session file locking, gateway status, `run --json`, and update hints.
- MCP configuration trust: a SHA-256 fingerprint over transport, command, arguments, URL, headers, environment, and private-network permission. Servers run only after an explicit `larecode mcp trust`; `mcp remove` revokes trust and `mcp list` shows drift.
- MCP HTTP transport rejects private, loopback, and link-local addresses unless the server is trusted with `--allow-private`.
- First-run hint that points a fresh install at `larecode setup`.
- Performance test with a 300-file workspace budget, third-party notice check, and a dependency-graph test that rejects dangling imports and unreachable modules.
- Coverage thresholds enforced in CI, with a retry only on CI for known-flaky timing tests.

### Changed

- Upgraded to Vitest 4.1, Vite 8, and `@vitest/coverage-v8` 4.1; the coverage gate excludes the npm launcher.
- CI now runs coverage, performance, Windows smoke, security tests, `bun audit`, and the tmux TUI test as separate jobs.
- Releases sign artifacts with keyless cosign and publish prereleases under the npm `next` tag.

### Security

- MCP servers require a pinned fingerprint; configuration drift blocks startup until trusted again.
- MCP HTTP connections cannot reach private networks without an explicit per-server opt-in.
- Documented supported versions, response targets, MCP trust boundaries, and the dependency audit cadence in `SECURITY.md`.

### Documentation

- New guides for extensions, observability, dependencies, and TUI usage; a rewritten release guide covering signature verification, canaries, and rollback drills.
- `docs/audit-0.3.0.md` records the P0/P1 review and sign-off for this release.

## [0.2.0] - 2026-10-21

### Added

- `AgentRuntime` contract types and ADR-0002, the first step toward one runtime for every surface.
- `DefaultAgentRuntime` now owns the chat loop; `ChatSession` is a thin adapter with unchanged behavior.
- `run`, server, gateway, cron, and SDK/ACP now use `AgentRuntimeLoop` with the build agent; gateway and cron pass their pre-authorized policies through.
- `AgentRuntime` accepts prior session history; server, gateway, and SDK/ACP replay it so multi-turn context survives turns.
- Empty provider responses now surface as an explicit `EMPTY_RESPONSE` error instead of a silent completed turn.
- Tool calls are validated against required arguments and declared types before permission checks or execution.
- Provider failures that are retryable (429, 5xx, network) are retried with exponential backoff and jitter before any text is streamed; 429 responses now report `RATE_LIMITED` with actionable retry guidance.
- Provider requests have a per-request timeout (`requestTimeoutMs`, default 120s) alongside the total turn duration budget; timeouts report `PROVIDER_TIMEOUT`.
- The TUI conversation scrolls back with PgUp and returns with PgDn without dropping messages.
- TUI errors include the error code and a next action instead of only the message.
- Chat sessions are saved after every turn and `larecode chat --resume <id>` restores the conversation and provider history. The user message is saved before the turn runs, so a crash keeps the last prompt.
- Opt-in `checkpoints` config records a git snapshot before and after each tool call.
- `larecode sessions rm <id>` deletes a session together with its checkpoints and share links.
- Default runtimes register the `lsp`, `task`, and `skill` tools, and `@general` subagent turns work in chat.
- Chat connects configured MCP servers at startup, registers their tools, and skips servers that fail to connect.
- Added an async `SessionStore` with file-backed and in-memory implementations.
- `larecode run` now exits `3` when a turn halts on a budget or limit and `130` when cancelled.
- The TUI re-renders on terminal resize and is tested at 40, 60, and 80 columns.
- Server, ACP, and SDK keep full conversation history across turns; ACP accepts runtime injection for providers and loop factories.
- Long conversations are compacted automatically before they exceed the runtime context budget, keeping recent tool calls intact.
- MCP tools now map to the `external-services` permission group, with adversarial tests for Docker/SSH argument quoting and provider streaming.
- `larecode doctor` now checks provider auth, model catalog, and a streaming probe instead of only reachability.
- Configs written by 0.1 are normalized on load: missing `allowedGroups`, `mcpServers`, and `execution` fields are filled in and the version is upgraded.
- `larecode setup` prompts for a provider, base URL, model, and API key in a terminal; flags still support scripted setup. A fresh config contains only the selected provider, so `doctor` does not report unused defaults. It rejects an invalid base URL or empty model before writing a config, and refuses to save a config that fails validation.
- Regression coverage proves that client disconnects abort server turns, MCP servers reconnect cleanly, and every package version matches the CLI.
- A real tmux smoke test drives the TUI, streams a turn, and resizes the window; CI now also verifies reproducible build hashes and pins Bun 1.3.9.
- Coverage baseline for 0.2.0: 86.9% of statements overall, with core at 90.4%, CLI at 61.9%, TUI at 93.1%, server at 81.5%, gateway at 94.4%, and SDK at 96.5%.
- The README claims are now audited against tests and workflows; plugin activation and memory retrieval are explicitly deferred to 0.3.0 instead of being advertised.
- A single session now continues across server, SDK, and ACP surfaces with full history.
- ACP turns run tools in the `cwd` supplied by `session/new` instead of the process directory; server and ACP write-tool round trips are covered end to end.
- Testing, troubleshooting, and release checklist documentation, plus a CI-enforced relative-link check for every Markdown file.
- The security policy now includes a trust-boundary diagram from model output to tool execution.

### Removed

- `AgentLoop` is no longer exported from the public core API; the tool-less completion path is no longer a supported surface.

### Fixed

- Logger entries redact secrets in messages, context, and error text before handlers receive them.
- Workspace path checks resolve symlinks, so tools can no longer read or write outside the working directory through a link.
- `write`, `edit`, and `patch` replace files atomically and keep the existing file mode, so an interrupted write cannot truncate the original.
- `read` rejects binary files with a clear error instead of returning decoded garbage.

## [0.1.1] - 2026-10-19

### Fixed

- Cross-compiled binaries install their own `@ast-grep/napi` binding, fixing startup crashes on the four non-host platforms.

### Added

- Releases ship a `checksums.txt` asset with the SHA-256 of every binary; `install.sh` verifies downloads when a checksum is provided through `LARECODE_SHA256`.
- Release manifests: a Homebrew formula, a Scoop manifest, and a PKGBUILD generated from the tagged release.

### Changed

- Tagged releases publish to npm and update the Homebrew tap and Scoop bucket automatically.

## [0.1.0] - 2026-10-19

First public release.

### Added

- Agent CLI and TUI: multi-provider chat, plan mode, subagents, skills, hooks, plugins, LSP, MCP client and server, checkpoints, memory, and session search.
- Permission engine: default-deny groups, audit log, and unattended flows limited to groups pre-authorized with `--allow`.
- Automation: HTTP server with scoped bearer tokens, share links, cron jobs, and a Telegram gateway.
- Distribution: npm, curl installer, Homebrew, Scoop, and a release PKGBUILD; five platform binaries built in CI.
- SDK (`@larecode/sdk`) and the ACP adapter for editors such as Zed.

### Fixed

- `larecode mcp serve` enforces the central tool-to-permission-group mapping before any tool runs; write and shell tools are denied by default and only open with `--allow`.

### Changed

- The desktop app is deferred; v1 ships as the CLI plus gateway and share links.

[Unreleased]: https://github.com/rsyyd/larecode/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rsyyd/larecode/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/rsyyd/larecode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rsyyd/larecode/releases/tag/v0.1.0
