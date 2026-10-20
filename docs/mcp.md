---
title: MCP
nav_order: 6
description: Use larecode as an MCP client, or expose it as an MCP server
---

# MCP

Lare Code speaks the Model Context Protocol in both directions.

## As a client

Add servers with commands or URLs and call their tools with an explicit permission check:

```bash
larecode mcp add context7 --preset context7
larecode mcp add local-tools --command npx --arg -y --arg my-mcp-server
larecode mcp list
larecode mcp call context7 resolve-library-id --args '{"libraryName":"express"}'
```

Presets cover `context7`, `playwright`, and `serena`. Calls check the `external-services` group; if your policy requires confirmation, re-run with `--yes`.

## As a server

Expose the built-in tools to other agents and editors:

```bash
larecode mcp serve --cwd /path/to/project --allow write
```

Protocol: newline-delimited JSON-RPC over stdio. The server implements `initialize`, `tools/list`, and `tools/call`.

### Permissions

MCP clients run without a human at the keyboard, so the server is default-deny:

- `read` tools are always available.
- Everything else needs `--allow <groups>`.
- `secrets` and `destructive` cannot be pre-authorized and are rejected at startup.

Requests for a denied tool return an MCP error result naming the group and reason, so the calling agent can explain the refusal instead of failing silently.

### Editor setup

Any MCP-capable editor works. For a generic stdio client:

```json
{
  "mcpServers": {
    "larecode": {
      "command": "larecode",
      "args": ["mcp", "serve", "--cwd", "."]
    }
  }
}
```

Logs go to stderr so stdout stays a clean protocol channel. Set `LARECODE_LOG_LEVEL=debug` when you need to see tool activity.

## Next steps

- [Permissions](permissions.md) for the groups `--allow` accepts.
- [SDK and editors](sdk.md) for the ACP adapter as an alternative integration.
