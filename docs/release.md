---
title: Release checklist
nav_order: 16
description: Preconditions and steps for a tagged larecode release
---

# Release checklist

A release is a tagged commit that passes every gate below. Patch releases fix defects only; features wait for the next minor. No date is promised, and a stability window is counted from the actual publish time.

## Preconditions

- [ ] Every required task for the target version is complete.
- [ ] `CHANGELOG.md` has an entry for every user-visible change.
- [ ] `bun run demo` was re-recorded so `docs/assets/demo.cast` matches the released TUI.
- [ ] CI is green on `main`, including the macOS, Windows, Node, coverage, performance, and security jobs.
- [ ] `bun audit --audit-level=high` is clean.
- [ ] No open security advisory affects the release.
- [ ] The previous minor has been public for its required stability window.

## Version bump

Update the version in all workspaces, not just the four release entry points:

- `packages/core/src/version.ts`
- `package.json`
- `packages/*/package.json`
- `npm/package.json`

`scripts/version.test.ts` fails if any workspace disagrees with the CLI version. Move the `Unreleased` section in `CHANGELOG.md` under the new version and date, then leave a fresh empty `Unreleased` section.

```bash
bun install
bun run format
bun run typecheck
bun run lint
bun run test
bun run test:coverage
bun run test:perf
bun run test:security
bun run build
bun audit --audit-level=high
```

## Smoke test

```bash
./dist/larecode --version
./dist/larecode doctor
./dist/larecode run "list the files in this directory"
tmux new-session -d -x 80 -y 24 './dist/larecode chat'
tmux capture-pane -p
```

Resize the tmux window to 40 columns and confirm the TUI reflows without clipped or duplicated lines. Exit the session with Ctrl+C. On Termux, repeat the version, doctor, and one real provider turn manually; CI cannot emulate Termux.

## Tag and publish

```bash
git add -A
git commit -m "release: 0.3.0"
git tag v0.3.0
git push origin main --follow-tags
```

The `release` workflow builds Linux, macOS, and Windows binaries, creates the GitHub release, generates package manifests and `checksums.txt`, signs each binary with Sigstore cosign, and publishes npm when `NPM_TOKEN` is set. Prerelease tags (`v0.3.0-beta.1`) are marked as GitHub prereleases and published to the npm `next` tag.

## Verify a release

```bash
gh release download v0.3.0 --pattern 'larecode-linux-x64' --pattern 'checksums.txt' \
  --pattern 'larecode-linux-x64.sig' --pattern 'larecode-linux-x64.pem'
sha256sum -c <(grep larecode-linux-x64 checksums.txt)
cosign verify-blob --certificate larecode-linux-x64.pem \
  --signature larecode-linux-x64.sig \
  --certificate-identity-regexp 'https://github.com/rsyyd/larecode/.github/workflows/release.yml@refs/tags/v0.3.0' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  larecode-linux-x64
npm view larecode version
```

- [ ] The GitHub release lists every binary, `checksums.txt`, `PKGBUILD`, `SRCINFO`, and a `.sig`/`.pem` pair per binary.
- [ ] The checksum and cosign verification both pass.
- [ ] `install.sh` installs the tagged version and verifies its checksum.
- [ ] `npm view larecode version` matches the tag; prereleases use the `next` dist-tag.
- [ ] The documentation site shows the new version and the changelog entry.
- [ ] `larecode update --check` reports the new version.

## Canary and beta

1. Tag `vX.Y.Z-alpha.1`; the workflow marks it as a prerelease and publishes npm under `next`.
2. Install it in a clean container and on one real machine: `npm install -g larecode@next`.
3. Run the surface matrix manually: `doctor`, one chat turn, one tool call with confirmation, `run --json`, `serve`, and `mcp list`.
4. Soak the canary for at least 48 hours. Watch issue reports and crash bundles; do not promote with an open P0/P1.
5. Tag `vX.Y.Z-beta.1` for a wider pass, then the final tag. The final tag must point at the same commit plus only release metadata changes.
6. If a canary fails, publish a new prerelease. Never move or delete a published tag.

## Rollback

Never delete a published tag or overwrite a signed asset. Choose the narrowest action:

| Failure                | Action                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Broken npm package     | `npm deprecate larecode@X.Y.Z "reason; install X.Y.(Z+1)"`, publish a patch, update the changelog.                                                                       |
| Broken binary asset    | Publish a patch release with corrected builds. If the binary is unusable and no patch is ready, mark the release as a prerelease and add a warning to the release notes. |
| Security regression    | Follow the advisory process in [SECURITY.md](../SECURITY.md); publish a patch before public details.                                                                     |
| Bad documentation only | Fix on `main`, publish with the next patch.                                                                                                                              |
| Bad release workflow   | Revert the workflow commit, tag a patch, and verify the signatures and checksums of the new assets.                                                                      |

Rollback drill (run before each minor release, on a scratch clone):

```bash
git tag v0.0.0-drill
npm pack ./npm --pack-destination /tmp/lare-drill
npm deprecate "larecode@0.0.0-drill" "drill" --dry-run 2>/dev/null || true
sha256sum /tmp/lare-drill/*.tgz
```

The drill proves the patch path and the checksum tooling. It must not publish. Record the date and result in the release pull request.

## After the release

- Bump `main` to the next `-dev` version or leave the released version until the next bump.
- Open a milestone for the next minor and move unfinished work.
- Keep the previous minor supported for security fixes until the next minor ships.
