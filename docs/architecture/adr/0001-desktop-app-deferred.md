# ADR-0001: Desktop app deferred to post-v1.0

## Status

Accepted

## Context

The PRD lists a desktop app as T-32, marked as a stretch goal whose acceptance criteria are "out of scope if M4 overruns", and §63 lists the desktop app among the v1.0 Non-Goals: "The PRD ends at the CLI + gateway + share links; everything else is future work."

Every v1.0 surface that a desktop shell would need already exists and is tested:

- `larecode serve`: HTTP API with SSE streaming, bearer tokens, read/write/run scopes (T-23).
- `@larecode/sdk`: pure TypeScript client over the same core, Node 20+, session continuity and usage reporting (T-30).
- `larecode acp`: Agent Client Protocol over stdio for editors such as Zed (T-30).
- `larecode mcp serve`: tool exposure to other agents, default read-only (T-31).
- Share links render from self-hosted `serve` only; a public hosted frontend is explicitly excluded (T-24, §5).

A native shell (Tauri/Electron) carries a heavy toolchain, packaging, signing, and update burden that cannot be built and verified within the CLI milestone budget, and the PRD grants no acceptance criteria beyond deferral.

## Decision

Close T-32 as deferred. v1.0 ships as the CLI plus gateway and share links. A desktop application remains future work and will get its own milestone, stack decision (for example Tauri versus Electron), and threat-model pass when it is scheduled.

## Consequences

Easier:

- M4 finishes with no unverifiable GUI code and no new heavy dependencies.
- The integration seams stay focused: any desktop client is a consumer of `serve`, the SDK, ACP, or MCP rather than a fork of core.

Harder:

- No graphical experience for v1.0 users; the TUI and editors remain the interactive surfaces.
- Whoever picks up the desktop work must first choose the shell framework, define packaging and signing, and extend the SECURITY.md trust model to the shell and its auto-update path.
