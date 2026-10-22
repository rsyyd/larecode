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
| `bun run test:coverage`      | Full suite under Node plus the coverage gate          |
| `bun run test:perf`          | Context indexing time and heap budget                 |
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

`.github/workflows/ci.yml` runs these jobs:

- **test** on Ubuntu and macOS with Bun: install, typecheck, full suite, lint, build, and a reproducible-build hash check on Ubuntu.
- **node** on Ubuntu: `tsc` and the full suite through Node with coverage thresholds.
- **perf** on Ubuntu: `bun run test:perf` indexes a 300-file fixture and enforces the time and heap budgets.
- **windows** on Windows: install, typecheck, and a CLI smoke run.
- **security** on Ubuntu: `bun audit --audit-level=high` and `bun run test:security`.
- **tmux** on Ubuntu: installs tmux and runs the TUI smoke test.

A pull request is mergeable only when every job is green.

## Flaky tests

CI retries a failed test once (`retry: 1` only when `CI` is set) so a transient timing failure does not block an unrelated pull request. A test that passes only on retry is still a defect:

1. Find the shared state, timing assumption, or real port instead of adding sleeps.
2. If it cannot be fixed immediately, move it to a quarantine file and open an issue with the failure log and owner.
3. Quarantined tests do not run in the required job and do not count toward coverage.
4. Delete the quarantine entry when the fix lands. Do not leave it for a whole minor.

A test that fails twice in CI is not retried again in the same run.

## Coverage baseline

`bun run test:coverage` writes an HTML report to `coverage/` and a JSON summary. It runs Vitest through Node because Bun does not expose the v8 coverage API on Termux.

Baseline on 2026-10-22 after the Vitest 4 / V8 AST-aware remapping, 86 files and 648 tests (one skipped):

| Package   | Statement coverage |
| --------- | ------------------ |
| core      | 87.0%              |
| cli       | 63.6%              |
| tui       | 81.2%              |
| server    | 84.5%              |
| gateway   | 92.2%              |
| sdk       | 93.6%              |
| skills    | 100%               |
| scripts   | 56.8%              |
| **total** | **83.0%**          |

The Vitest 4 V8 provider counts implicit branches and functions more granularly than the 2.x baseline, so these numbers are lower than the 0.2.0 report even though the tests did not regress. Coverage is a merge gate in the **node** job. `vitest.config.ts` enforces global statements at 83%, branches at 72%, functions at 85%, lines at 85%, and at least 80% statements/lines and 75% branches, 80% functions for core. A change may raise a threshold; lowering one needs a reason in the pull request and a follow-up issue.

`bun run test:perf` indexes 300 generated TypeScript files and fails above 15 seconds or 256 MB of heap growth. The budget is intentionally loose so shared CI runners do not flake; it catches order-of-magnitude regressions, not small ones. Run it locally before changing the context indexer.

## Manual checks

These are not in CI:

- A live provider turn with your own key (`larecode doctor`, then `larecode run "say hi"`).
- Termux on Android; the tmux smoke test runs on Ubuntu CI but not inside Termux. Repeat `--version`, `doctor`, and one turn manually before a release.
- Windows through the npm package. CI runs a typecheck and CLI smoke test on `windows-latest`, but not the full suite; the TUI target is WSL.

## Adding a test

- Mock the provider by passing a `fetchImpl` or pointing `baseUrl` at a local server; never call a live API.
- Write files under a temporary directory created with `mkdtemp`, and remove it in `afterEach`.
- Turn off retry delays (`retryDelayMs: 0`) and use short timeouts.
- A bug fix gets a regression test that fails before the fix.
- A new dependency boundary or parser gets an adversarial case, not only the happy path.
