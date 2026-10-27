---
title: Architecture
nav_order: 19
has_children: true
description: How larecode is built: the surface contract and the decision records
---

# Architecture

Lare Code is one agent runtime behind several surfaces: the TUI, the one-shot `run` command, the HTTP server, the gateway, and cron. These pages record the contracts and the decisions behind them.

- [Surface contract]({{ '/architecture/surfaces.html' | relative_url }}): start, stream, cancel, stop, and status per surface
- [ADR-0001: Desktop app deferred]({{ '/architecture/adr/0001-desktop-app-deferred.html' | relative_url }}): why v1 ends at the CLI
- [ADR-0002: Agent runtime contract]({{ '/architecture/adr/0002-agent-runtime-contract.html' | relative_url }}): one runtime for every surface
- [ADR-0003: Session store]({{ '/architecture/adr/0003-session-store.html' | relative_url }})
- [ADR-0004: Context injection]({{ '/architecture/adr/0004-context-injection.html' | relative_url }})
- [ADR-0005: Permissions and audit]({{ '/architecture/adr/0005-permissions-and-audit.html' | relative_url }})
- [ADR-0006: Providers]({{ '/architecture/adr/0006-providers.html' | relative_url }})
