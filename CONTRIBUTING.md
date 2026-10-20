# Contributing

Thanks for your interest in improving Lare Code. Bug reports, documentation fixes, provider adapters, and tests are the most useful contributions.

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Node 20+ if you plan to test the npm bundle

## Setup

```bash
git clone https://github.com/rsyyd/larecode
cd larecode
bun install
bun run build
./dist/larecode doctor
```

## Checks

Run these before every push. CI runs the same set and will fail without them.

```bash
bun run format      # prettier
bun run typecheck   # tsc --noEmit
bun run test        # vitest
bun run lint        # oxlint
bun run build       # compile dist/larecode
```

## Pull requests

- Keep pull requests small and focused. One change per PR is the target.
- Use a conventional title: `feat:`, `fix:`, `docs:`, `chore:`, `test:`.
- Link the issue you are fixing when one exists.
- Describe what changed and why, and include the evidence: tests you added, commands you ran, or output you checked.
- Every new behavior needs a test. Bug fixes need a test that fails without the fix.

If you used AI assistance, you are still the author. Read and understand every line you submit; pull requests that cannot be explained or defended by their author will be closed.

## Security

Do not open public issues for security problems. See [SECURITY.md](SECURITY.md) for private reporting and the supported versions.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold its terms.
