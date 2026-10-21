---
title: README claims
nav_order: 14
description: Each public claim and the test or workflow that proves it
---

# README claims

This matrix keeps the README honest. A claim is either backed by a test that runs in CI or marked as not shipped.

| Claim                                     | Evidence                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Provider neutral, six provider types      | `packages/core/src/provider/provider-contract.test.ts`, adapter tests, `doctor` model checks |
| Every tool call passes a permission check | `packages/core/src/permission/permission.test.ts`, `tool-groups.test.ts`, security suite     |
| Default deny and explicit confirmation    | Runtime tests, `packages/gateway/src/telegram.test.ts`, `packages/cli/src/cron.test.ts`      |
| One agent loop across surfaces            | `packages/cli/src/surface-matrix.test.ts`, `packages/core/src/agent/runtime.test.ts`         |
| Plan mode is read-only                    | `packages/core/src/agent/agents.test.ts`                                                     |
| Subagents and skills                      | `subagent.test.ts`, `skill.test.ts`, TUI `@general` test                                     |
| Checkpoints and session search            | `checkpoint.test.ts`, `session/search.test.ts`, chat persistence tests                       |
| Structural search and LSP                 | `astgrep.test.ts`, `lsp` tool tests                                                          |
| MCP client and server                     | `packages/core/src/mcp/mcp.test.ts`, MCP server mode tests                                   |
| HTTP server, shares, cron, gateway        | `server.test.ts`, `share` tests, `cron.test.ts`, `telegram.test.ts`                          |
| Install paths and binaries                | `scripts/packaging.test.ts`, `install.test.ts`, `.github/workflows/release.yml`              |
| Node 20+                                  | `npm/package.json` engines and the `node` CI job                                             |
| Reproducible builds                       | `scripts/version.test.ts` and the Ubuntu reproducible-build step                             |
| TUI works in a real terminal              | `packages/tui/src/*.test.tsx`, `scripts/tmux.test.ts` in CI                                  |

## Not shipped yet

These are planned for 0.3.0 and are not advertised in the README:

- Plugin activation and hooks in the main surfaces (EXT-11/EXT-12).
- Memory retrieval into the prompt (CTX-09/CTX-10).
- First-class Windows terminal support; Windows uses WSL or the npm package.
- Multi-tenant server or gateway use; the trust model assumes one device owner.
