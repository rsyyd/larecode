---
title: 0.3.0 audit
nav_order: 21
description: P0/P1 review, evidence, residual risk, and sign-off for the 0.3.0 release
---

# 0.3.0 audit

Date: 2026-10-22
Scope: every change since `v0.2.0`, with emphasis on context injection, MCP trust, provider fallback, and release automation.

This is an internal P0/P1 quality review, not the external security audit required before 1.0.0.

## Method

- Read the diff for every changed runtime, permission, context, MCP, and release path.
- Traced untrusted input from config, MCP responses, tool output, and HTTP redirects to where it is injected or executed.
- Ran the full test suite, the security subset, the performance budget, the dependency graph check, the packaging checks, the build, and a dependency audit.
- Verified that each README claim maps to a test or workflow in `docs/claims.md`.

## Findings

| ID    | Severity | Finding                                                                                     | Resolution                                                                                    |
| ----- | -------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| AUD-1 | P1       | MCP servers configured in a project file ran without user consent.                          | Added a SHA-256 config fingerprint and explicit `mcp trust`; untrusted servers are skipped.   |
| AUD-2 | P1       | MCP HTTP could reach loopback, private, and link-local addresses.                           | `assertPublicHttpUrl` now gates HTTP transport; `--allow-private` is a per-server opt-in.     |
| AUD-3 | P1       | A crash between saving the user turn and saving the reply could replay the turn or lose it. | Added `pendingTurn` state and `Sessions.recoverPending()`; recovery is idempotent and tested. |
| AUD-4 | P2       | Coverage was reported but not enforced.                                                     | Added global and core thresholds to `vitest.config.ts` and a required CI job.                 |
| AUD-5 | P2       | Release binaries had checksums but no signature.                                            | Keyless cosign signs each artifact and uploads `.sig` and `.pem` with the release.            |
| AUD-6 | P2       | A transient timing failure could fail an unrelated pull request.                            | CI retries once; `docs/testing.md` treats a retry-only pass as a defect.                      |

No open P0 or P1 findings remain in this scope.

## Evidence

- Full suite: 648 tests across 86 files, 647 passed and 1 skipped, on 2026-10-22.
- `bun run test:security` covers default deny, path traversal, quoting, MCP trust, SSRF, and consent.
- `bun run test:perf` indexes a 300-file workspace within the 15 s and 256 MB budget.
- `scripts/dependency-graph.test.ts` finds no dangling relative import and no module unreachable from a package entry point.
- `scripts/notices.test.ts` verifies the generated third-party notice file against direct runtime dependencies.
- `bun audit --audit-level=high` reports no vulnerabilities.
- `bun run build` produces the single-file binary; CI also verifies a reproducible hash.
- `bun run test:coverage` passes the global and core thresholds.

## Residual risk

- The SSRF check resolves the hostname before the request; a DNS answer that changes between check and connect (DNS rebinding) is not defeated. The guard raises the cost of the trivial cases, not a determined attacker. A trusted MCP server can still read anything the process can read.
- MCP trust is per configuration fingerprint, not per tool or per response. A trusted server can return prompt-injected content; tool output is still data, never instructions, and external-service calls still need permission.
- The plugin loader and trust model exist but plugins are not activated by the main surfaces. No plugin is advertised as active.
- Termux is documented and smoke-tested through tmux on Ubuntu, not on a real device. Windows is a typecheck and CLI smoke test, not a full suite.
- Keyless cosign verification depends on the public Rekor log and Fulcio roots.
- No external security audit has run. That remains a 1.0.0 gate.

## Sign-off

Prepared by the automated maintainer review on 2026-10-22. The release may be tagged `v0.3.0` because no P0/P1 finding is open and every gate above passed. The external audit and the 30-day stability window still block 1.0.0.
