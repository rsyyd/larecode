---
title: CLI reference
nav_order: 9
description: Every larecode command and option
---

# CLI reference

Global options: `-V, --version` prints the version, `-h, --help` prints help for any command.

## larecode chat

Open the interactive terminal UI. This is also what bare `larecode` starts.

```text
larecode chat [options]

--provider <name>  provider to use
--model <name>     model to use
--resume <id>      resume a saved session
```

Each turn is saved to the session store under `~/.larecode/sessions`, and `--resume <id>` restores the conversation and its provider history. Inside the UI, Enter sends, Ctrl+J adds a newline, Esc stops a reply, Tab switches between plan and build, PgUp/PgDn scrolls the conversation, `/clear` resets the conversation, and Ctrl+C exits. Tools that need approval show a `y/n` prompt. Prefix a message with `@general ` to delegate read-only research to the general subagent.

## larecode sessions

Manage saved chat sessions.

```text
larecode sessions rm <id>
```

`rm` deletes the session, its checkpoints, and any share links that point at it. Session ids are the file names under `~/.larecode/sessions`.

## larecode setup

Write an initial config for your provider.

```text
--provider <name>  provider name
--type <type>      openai-compatible, anthropic, or ollama
--base-url <url>   provider base url
--api-key <key>    api key for the provider
--model <model>    default model
--force            overwrite an existing config
```

## larecode doctor

Check configuration, providers, permissions, and instruction files. Takes no options.

## larecode run

Run a task non-interactively and stream the result.

```text
larecode run [options] <task>

--verify           record a test baseline first and fail only on new test failures
--provider <name>  provider to use for this run
--model <name>     model to use for this run
```

Exit codes: `0` success, `1` error, `3` halted before finishing (budget, iterations, or tool-call limit), `130` cancelled.

## larecode serve

Serve the HTTP API with SSE streaming.

```text
--port <port>    port to listen on
--host <host>    host to bind
--token <token>  bearer token (default: LARECODE_SERVER_TOKEN or generated)
```

## larecode gateway

Serve tasks from a messaging platform (Telegram).

```text
--platform <name>  platform to connect (telegram)
--token <token>    bot token (default: LARECODE_TELEGRAM_TOKEN)
--chat <id>        only serve this chat id (default: LARECODE_TELEGRAM_CHAT_ID)
--allow <groups>   comma-separated permission groups pre-authorized for gateway tasks
```

## larecode mcp

Manage MCP servers and call their tools.

```text
larecode mcp list                            list configured MCP servers
larecode mcp add [options] [name]            add or update an MCP server
larecode mcp remove <name>                  remove an MCP server
larecode mcp serve [options]                expose larecode tools as an MCP server over stdio
larecode mcp call [options] <server> <tool>  call a tool on an MCP server
```

`mcp add` options:

```text
--preset <preset>        preset server (context7, playwright, serena)
--command <command>      stdio: executable to spawn
--arg <value...>         stdio: command arguments
--env <key=value...>     stdio: environment variables
--url <url>              http: server URL
--header <key=value...>  http: request headers
```

`mcp call` options:

```text
--args <json>  tool arguments as JSON
--yes          confirm the call when the permission mode requires it
```

`mcp serve` options:

```text
--allow <groups>  comma-separated permission groups to pre-authorize (read is always on)
--cwd <path>      working directory for tool execution
```

## larecode cron

Scheduled unattended tasks.

```text
larecode cron add [options] <schedule> <prompt...>  add a cron job
larecode cron list                                 list jobs with next run and last result
larecode cron remove <id>                          remove a cron job
larecode cron run <id>                             run a job now, unattended
larecode cron start                                run due jobs on their schedule until interrupted
```

Schedules accept `every 30 minutes`, `daily at 09:00`, `weekdays at 9am`, or a 5-field cron expression. `cron add` options:

```text
--name <name>     job name
--allow <groups>  comma-separated permission groups pre-authorized for this job
```

## larecode update

Check for a newer larecode release.

```text
--check  report without upgrade instructions
```

## larecode acp

Speak Agent Client Protocol over stdio for editors such as Zed. Takes no options.
