# Security

## Reporting a vulnerability

Open a private security advisory at https://github.com/rsyyd/larecode/security/advisories/new, or email the maintainer listed on the GitHub profile. Please include a repro and the version (`larecode --version`). Do not open public issues for exploitable bugs.

Supported: the latest release and `main`.

## Trust model

Lare Code runs on your machine with your permissions. Everything below is about keeping that power deliberate, not ambient.

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

### What is explicitly out of scope

- Multi-tenant use of the gateway or server. v1 assumes the caller is the owner.
- A malicious model provider. If your endpoint lies, your output lies.
- OS-level sandboxing of the `local` execution backend. Use `docker` for that.
- Adversarial input to the TUI itself (terminal escape sequences in model output are a known, accepted risk).

## Supply chain

- Runtime dependencies are intentionally few and permissively licensed (`@modelcontextprotocol/sdk` MIT, `@ast-grep/napi` MIT).
- Release binaries are built in GitHub Actions from tagged commits and uploaded with checksums; `install.sh` verifies the checksum when one is provided.
- `larecode update` reports versions and instructions; it never executes an upgrade on its own.

## Boundary review (T-31)

This pass reviewed every surface added through M4. One finding was fixed:

- MCP server mode (`larecode mcp serve`) initially relied on per-tool checks, but file and shell tools carried no internal gates, so an editor agent could write or execute freely. Fixed by centralizing the tool-to-group mapping in core (`toolPermissionGroup`, unknown tools fall back to `write`) and enforcing it at the MCP server boundary before any tool runs. The same mapping is now documented in `docs/permissions.md` and covered by tests that assert write is denied by default and only opens with `--allow write`.

No other boundary accepted calls in an unattended mode without an explicit pre-authorization path.
