# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Product requirements document covering 16 sub-PRDs, 280 tasks, release gates, and the 0.2.0-1.0 version plan.
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

[Unreleased]: https://github.com/rsyyd/larecode/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/rsyyd/larecode/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rsyyd/larecode/releases/tag/v0.1.0
