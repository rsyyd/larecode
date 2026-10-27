---
title: Dependency policy
nav_order: 15
description: How dependencies are added, updated, and audited
---

# Dependency policy

Lare Code prefers the standard library and the platform it already targets. A new runtime dependency needs a reason that cannot be met by existing code, plus a license that is compatible with MIT.

## Rules

- Runtime dependencies stay few. Today they are the MCP SDK, `@ast-grep/napi`, and the TUI stack (Ink and React); see `THIRD_PARTY_NOTICES.md`.
- Never add a dependency for a few lines of code. Use the standard library first.
- A dependency must be pinned by the lockfile and installed with `bun install --frozen-lockfile` in CI.
- `@larecode/*` workspace packages are always `*`; versions come from the root release.
- A package with a copyleft license or an unknown license is rejected.

## Cadence

- **Every CI run:** `bun audit --audit-level=high`, required to pass.
- **Every pull request:** review the lockfile diff and the reason for each new package.
- **Monthly:** run `bun update` for patch/minor releases, `bun run test`, `bun audit`, and commit in one dependency-only change.
- **Quarterly:** review major versions and the dependency list; remove what is unused.
- **Immediately:** patch a critical or high advisory in a runtime dependency, even outside the cadence.

Dependabot opens weekly npm and GitHub Actions updates. Security updates take priority over the monthly batch.

## Handling an advisory

1. Confirm the affected version range and whether the vulnerable path is reachable at runtime. Dev-only findings are still fixed, but they do not block a release on their own.
2. Prefer upgrading or replacing the package. Patching a transitive package with a lockfile override is a temporary exception.
3. If an exception is unavoidable, add it to `bun audit --ignore` with a comment, an owner, and a removal date in the pull request. Do not silence a critical runtime advisory.
4. Re-run `bun run test`, `bun run test:security`, and `bun audit --audit-level=high`.
5. Note user-visible security fixes in `CHANGELOG.md`; see [Security](../SECURITY.md) for disclosure.

## Verifying what ships

`scripts/notices.test.ts` fails when a direct runtime dependency is missing from `THIRD_PARTY_NOTICES.md`. Regenerate the notices (license texts included) when the runtime tree changes, then run the test.

## Removing a dependency

Delete the import, the manifest entry, and its notices entry in the same change. Run the full suite and `bun audit` again. A dependency that is no longer imported should not stay in the lockfile or the notices.
