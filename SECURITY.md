# Security Policy

## Supported versions

| Version                | Supported |
| ---------------------- | --------- |
| latest release (0.1.x) | yes       |
| `main`                 | yes       |

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/rsyyd/larecode/security/advisories/new). Please include:

- the larecode version (`larecode --version`) and your OS,
- a minimal reproduction, and
- the impact you see.

Do not open public issues for exploitable bugs. Reports are handled on a best-effort basis by the maintainer.

## Scope

Lare Code runs on your machine with your permissions. The trust model below is about keeping that power deliberate, not ambient. Anything not listed as a boundary is out of scope.

### Out of scope

- Multi-tenant use of the gateway or HTTP server. v1 assumes the caller is the device owner.
- A malicious model provider. If your endpoint lies, your output lies.
- OS-level sandboxing of the `local` execution backend. Use the `docker` backend for that.
- Adversarial input to the TUI itself. Terminal escape sequences in model output are a known, accepted risk.

### Boundaries

| Surface              | Trust level           | Controls                                                                                    |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| Permission engine    | Enforcer              | Default-deny groups, `secrets`/`destructive` never auto-approved, audit log                 |
| Built-in tools       | Gated                 | Every tool maps to a permission group; unknown names default to `write`                     |
| Project files        | Untrusted input       | Instruction files (AGENTS.md and friends) need consent; a changed hash revokes it           |
| MCP servers (client) | Untrusted             | `external-services` group, explicit confirmation, 15s request timeout                       |
| MCP server (mode)    | Untrusted clients     | Default read-only, `--allow` to widen, `secrets`/`destructive` refused at startup           |
| HTTP server          | Authenticated callers | Bearer tokens, per-token scopes (`read`/`write`/`run`), timed-safe compare, body size limit |
| Share links          | Public by token       | Unguessable token, secrets redacted at render time, revocable                               |
| Gateway              | Single owner          | Chat allowlist; the remote human is the device owner, multi-user is a non-goal              |
| Execution backends   | Contained by choice   | Docker runs with `--network none` unless opted in; SSH is key-only batch mode               |
| Local secrets        | Do not leak           | Config files written `0600`; logging redacts secret-shaped values                           |

## Supply chain

- Runtime dependencies are intentionally few and permissively licensed (`@modelcontextprotocol/sdk` MIT, `@ast-grep/napi` MIT).
- Release binaries are built in GitHub Actions from tagged commits and uploaded with checksums; `install.sh` verifies the checksum when one is provided.
- `larecode update` reports versions and instructions; it never executes an upgrade on its own.
