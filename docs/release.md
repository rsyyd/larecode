---
title: Release checklist
nav_order: 12
description: Preconditions and steps for a tagged larecode release
---

# Release checklist

A release is a tagged commit that passes every gate below. Patch releases fix defects only; features wait for the next minor.

## Preconditions

- [ ] Every required task for the target version is complete.
- [ ] `CHANGELOG.md` has an entry for every user-visible change.
- [ ] CI is green on `main`, including the macOS, Node, and security jobs.
- [ ] No open security advisory affects the release.

## Version bump

Update the same version in all four places:

- `packages/core/src/version.ts`
- `package.json`
- `packages/cli/package.json`
- `npm/package.json`

Move the `Unreleased` section in `CHANGELOG.md` under the new version and date. Leave a fresh empty `Unreleased` section.

```bash
bun install
bun run format
bun run typecheck
bun run lint
bun run test
bun run test:security
bun run build
```

## Smoke test

```bash
./dist/larecode --version
./dist/larecode doctor
./dist/larecode run "list the files in this directory"
tmux new-session -d -x 80 -y 24 './dist/larecode chat'
tmux capture-pane -p
```

Resize the tmux window to 40 columns and confirm the TUI reflows without clipped or duplicated lines. Exit the session with Ctrl+C.

## Tag and publish

```bash
git add -A
git commit -m "release: 0.2.0"
git tag v0.2.0
git push origin main --follow-tags
```

The `release` workflow builds Linux, macOS, and Windows binaries, creates the GitHub release, generates package manifests and `checksums.txt`, publishes npm when `NPM_TOKEN` is set, and updates the AUR and package managers when their keys are present.

## Verify

- [ ] The GitHub release lists every binary, `checksums.txt`, `PKGBUILD`, and `SRCINFO`.
- [ ] `sha256sum -c checksums.txt` passes for the downloaded binary.
- [ ] `install.sh` installs the tagged version and verifies its checksum.
- [ ] `npm view larecode version` matches the tag.
- [ ] The documentation site shows the new version and the changelog entry.
- [ ] `larecode update --check` reports the new version.

## Rollback

Do not delete a published tag. Publish a patch that reverts the change, mark the broken npm version with `npm deprecate`, and note the issue in the changelog. If a binary is broken, replace the release asset and regenerate `checksums.txt`, then announce the corrected checksum.
