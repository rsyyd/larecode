---
title: Tools
nav_order: 5
description: Built-in tools and how they map to permission groups
---

# Tools

Lare Code ships a set of built-in tools. Group names in the table map to [permissions](permissions.md).

| Tool             | Group      | What it does                                           |
| ---------------- | ---------- | ------------------------------------------------------ |
| `read`           | `read`     | Read a file with line numbers                          |
| `glob`           | `read`     | Find files by pattern                                  |
| `grep`           | `read`     | Search file contents                                   |
| `ast_grep`       | `read`     | Structural code search over the syntax tree            |
| `lsp`            | `read`     | Language server queries (definitions, references)      |
| `session_search` | `read`     | Search previous sessions                               |
| `write`          | `write`    | Write a text file, creating parent directories         |
| `edit`           | `write`    | Replace an exact string in a file                      |
| `patch`          | `write`    | Apply a patch to a file                                |
| `bash`           | `shell`    | Run a command through the configured execution backend |
| `web_fetch`      | `network`  | Fetch a URL as text                                    |
| `web_search`     | `network`  | Search the web                                         |
| `browser`        | `browser`  | Drive a headless browser                               |
| `skill`          | `skills`   | Load a skill pack                                      |
| `task`           | `subagent` | Delegate to a subagent                                 |

## Execution backends

`bash` runs through the backend set in `execution` config: `local`, `docker`, or `ssh`. Docker containers start with networking off unless you opt in. See [configuration](configuration.md).

## MCP

Two directions:

- Client: connect external MCP servers and call their tools (`larecode mcp add`, `mcp list`, `mcp call`; group `external-services`).
- Server: expose larecode tools to other agents over stdio (`larecode mcp serve`, default read-only).

See [MCP](mcp.md).

## Adding tools

A tool is a plain TypeScript object: a name, a description, a JSON schema, and an `execute(args, context)` function. The registry registers tools by name. See `packages/core/src/tool/` for the built-ins.
