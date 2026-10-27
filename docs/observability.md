---
title: Observability
nav_order: 13
description: Local metrics, usage, debug bundles, crash reports, and the audit log
---

# Observability

Everything is local and opt-in by running a command. There is no telemetry, no background upload, and no account.

## Usage summary

```bash
larecode usage
larecode usage --json
```

Reads saved session metadata and reports session count, message count, tokens, cost, and a per-provider/model breakdown. Missing provider usage falls back to the calibrated token estimate; unknown models report zero cost rather than a guess. Session metadata stores provider, model, working directory, token counts, and cost, but not prompt text in the summary.

## Runtime metrics

The agent records turns, retries, and per-tool/per-provider call counts, errors, and total latency in memory. They are included in the debug bundle and shown by `/status` in the TUI. Metrics reset when the process exits; they are not written to disk on their own.

Budgeted fields in a debug bundle:

```json
{
  "metrics": {
    "startedAt": 0,
    "turns": 0,
    "retries": 0,
    "tools": { "calls": 0, "errors": 0, "totalMs": 0, "byName": {} },
    "providers": { "calls": 0, "errors": 0, "totalMs": 0, "byName": {} }
  }
}
```

No prompts, tool arguments, or file contents are recorded.

## Debug bundle

```bash
larecode debug
larecode debug --json
```

Writes a redacted JSON bundle to `~/.larecode/debug/bundle-<timestamp>.json` (0600). It contains the version and OS, the effective config with secrets redacted, the in-memory metrics, and the usage summary. Review it before attaching it to an issue.

## Crash reports

The CLI installs a crash reporter at startup. An uncaught exception or unhandled rejection writes `~/.larecode/crashes/crash-<timestamp>.json` (0600) with the redacted error, stack, and environment summary, prints the path, and exits non-zero. Crash reports are never sent anywhere automatically. Delete them at any time.

## Audit log

Every tool permission decision is appended to a hash-chained audit log:

```bash
larecode audit --verify
```

The verifier recomputes the chain and reports the first broken link. A break means the file changed outside larecode; it does not block future turns, but treat the affected range as untrusted. The log records the tool name, permission group, decision, confirmation state, and source, not tool output.

## Logs

Set `LARECODE_LOG_LEVEL=debug` for verbose logs on stderr. Logs redact secret-shaped values such as API keys and bearer tokens. `LARECODE_LOG_LEVEL=error` is the quiet setting for scripts.

## What is not collected

- No analytics, crash upload, or version ping.
- No prompt or response text in metrics, bundles, or the audit log.
- No cloud sync of sessions or memory.
- MCP server stderr and plugin stderr are logged locally at debug level and are not uploaded.

## See also

- [Troubleshooting](troubleshooting.md) for provider and permission failures.
- [Security](../SECURITY.md) for the trust boundaries these signals cover.
- [Testing](testing.md) for the perf and coverage gates.
