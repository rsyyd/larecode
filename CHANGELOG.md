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
