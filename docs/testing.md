---
title: Testing
nav_order: 10
description: Test layers, commands, and what CI enforces
---

# Testing

Every behavior that can break is covered by a test that runs without network access. Provider calls are mocked with a local `fetch` or a temporary HTTP server.

## Commands

| Command                      | What it checks                                        |
| ---------------------------- | ----------------------------------------------------- |
| `bun run test`               | Full Vitest suite                                     |
| `bun run test:security`      | Permission, execution, MCP, consent, auth, and policy |
| `bun run typecheck`          | `tsc --noEmit`                                        |
| `bun run lint`               | `oxlint`                                              |
| `bun run format:check`       | Prettier without writing                              |
| `bun run build`              | Single-file binary in `dist/larecode`                 |
| `bunx vitest run --coverage` | Coverage report (not gated)                           |

## Layers

| Layer         | Location                                  | Covers                                                        |
| ------------- | ----------------------------------------- | ------------------------------------------------------------- |
| Unit          | `packages/*/src/**/*.test.ts`             | Runtime loop, providers, tools, sessions, config, permissions |
| Surface       | `packages/cli/src/surface-matrix.test.ts` | Chat, run, server, ACP, gateway, cron, and SDK end to end     |
| TUI           | `packages/tui/src/*.test.tsx`             | Keyboard input, permission prompts, 40/60/80-column layouts   |
| Security      | `bun run test:security`                   | Default deny, path traversal, quoting, token scopes, consent  |
| Documentation | `scripts/links.test.ts`                   | Every relative Markdown link resolves                         |

The surface matrix uses one fake provider and a shared session store, so it can prove that history and tool calls survive across surfaces without a real model.

## CI

`.github/workflows/ci.yml` runs four jobs:

- **test** on Ubuntu and macOS with Bun: install, typecheck, full suite, lint, build, and a reproducible-build hash check on Ubuntu.
- **node** on Ubuntu: `tsc` and the full suite through Node instead of Bun.
- **security** on Ubuntu: `bun run test:security`.
- **tmux** on Ubuntu: installs tmux and runs the TUI smoke test.

A pull request is mergeable only when all four are green.

## Coverage baseline

`bun run test:coverage` writes an HTML report to `coverage/` and a JSON summary. It runs Vitest through Node because Bun does not expose the v8 coverage API on Termux.

Baseline on 2026-10-21, 74 files and 582 tests:

| Package   | Statement coverage |
| --------- | ------------------ |
| core      | 90.4%              |
| cli       | 61.9%              |
| tui       | 93.1%              |
| server    | 81.5%              |
| gateway   | 94.4%              |
| sdk       | 96.5%              |
| skills    | 100%               |
| scripts   | 81.5%              |
| **total** | **86.9%**          |

Coverage is a baseline, not a merge gate. A change should not lower a package by more than one point without a reason in the pull request.

## Adding a test

- Mock the provider by passing a `fetchImpl` or pointing `baseUrl` at a local server; never call a live API.
- Write files under a temporary directory created with `mkdtemp`, and remove it in `afterEach`.
- Turn off retry delays (`retryDelayMs: 0`) and use short timeouts.
- A bug fix gets a regression test that fails before the fix.
- A new dependency boundary or parser gets an adversarial case, not only the happy path.

## Manual checks

These are not in CI:

- A live provider turn with your own key (`larecode doctor`, then `larecode run "say hi"`).
- Termux on Android; the tmux smoke test runs on Ubuntu CI but not inside Termux.
- Windows through WSL or the npm package.
- Editor integration with Zed or another ACP client.
