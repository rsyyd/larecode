# Permissions

Every tool call is checked against a permission group before it runs. The engine is default-deny: a group must be allowed by policy, or the call is refused.

## Groups

| Group               | Covers                                              |
| ------------------- | --------------------------------------------------- |
| `read`              | Reading files, searching the workspace              |
| `write`             | Creating or modifying files                         |
| `shell`             | Executing commands                                  |
| `network`           | Outbound requests (web fetch, web search, HTTP MCP) |
| `git`               | Git operations                                      |
| `external-services` | Calling tools on configured MCP servers             |
| `subagent`          | Spawning task subagents                             |
| `browser`           | Browser automation                                  |
| `skills`            | Loading skill packs                                 |
| `secrets`           | Reading secret material (never auto-approved)       |
| `destructive`       | Irreversible operations (never auto-approved)       |

`secrets` and `destructive` always require explicit confirmation and can never be pre-authorized for unattended flows.

## Policy

```json
{ "permissions": { "mode": "ask", "allowedGroups": ["read"] } }
```

| Mode    | Behavior                                                         |
| ------- | ---------------------------------------------------------------- |
| `ask`   | Groups in `allowedGroups` run; everything else must be confirmed |
| `allow` | Every group except `secrets` and `destructive` runs              |
| `deny`  | Nothing runs                                                     |

The default is `ask` with `read` allowed.

## Unattended flows

Cron jobs, the gateway, and the MCP server run without a human to confirm anything. They use the same default-deny rule: only groups you list with `--allow` are pre-authorized, and `secrets`/`destructive` are rejected at argument parsing time.

```bash
larecode cron add "daily at 09:00" "summarize new issues" --allow shell,network
larecode gateway --allow network
larecode mcp serve --allow write
```

## Tool to group mapping

| Tools                                                       | Group               |
| ----------------------------------------------------------- | ------------------- |
| `read`, `glob`, `grep`, `ast_grep`, `lsp`, `session_search` | `read`              |
| `write`, `edit`, `patch`                                    | `write`             |
| `bash`                                                      | `shell`             |
| `web_fetch`, `web_search`                                   | `network`           |
| `browser`                                                   | `browser`           |
| `skill`                                                     | `skills`            |
| `task`                                                      | `subagent`          |
| MCP server tool calls                                       | `external-services` |

Unknown tool names fall back to the `write` group so new tools are never silently permissive.

## Audit log

Every decision (allowed, refused, or requiring confirmation) is recorded with the group, source, and reason. The audit log is the record of what ran on your machine and why. `larecode doctor` surfaces pending or changed instruction files, which are the other untrusted input in the system.

See [SECURITY.md](../SECURITY.md) for the full trust model.
