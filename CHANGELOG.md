# Changelog

## 0.1.1 — 2026-10-19

Release plumbing only; no code changes.

- Cross-compiled binaries now install their own `@ast-grep/napi` binding, fixing startup crashes on the four non-host platforms.
- Each release ships `checksums.txt`, so `install.sh` can verify downloads through `LARECODE_SHA256`.
- Tagged releases publish to npm and update the Homebrew formula and Scoop manifest automatically.

## 0.1.0 — 2026-10-19

First public release.

- Agent CLI and TUI: multi-provider chat, plan mode, subagents, skills, hooks, plugins, LSP, MCP client and server, checkpoints, memory, and session search.
- Automation: HTTP server with scoped tokens, share links, cron jobs, and a Telegram gateway.
- Distribution: npm, curl installer, Homebrew, Scoop, and a release PKGBUILD; five platform binaries built in CI.
- SDK (`@larecode/sdk`) and the ACP adapter for editors.

The desktop app is deferred; v1 is the CLI plus gateway and share links.
