---
title: CLI reference
nav_order: 11
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

Each turn is saved to the session store under `~/.larecode/sessions`, and `--resume <id>` restores the conversation and its provider history. Inside the UI, Enter sends, Ctrl+J adds a newline, Esc stops a reply, Tab switches between plan and build, PgUp/PgDn scrolls the conversation, `/clear` resets the conversation, and Ctrl+C exits. Tools that need approval show a `y/n` prompt. Prefix a message with `@general ` to delegate read-only research to the general subagent. Type `@` and part of a filename to pick a project file. `/search <text>` jumps to a match, `/copy` copies the last answer, and `/export [file]` writes the transcript as markdown.

## larecode sessions

Manage saved chat sessions.

```text
larecode sessions list [--json]
larecode sessions show <id> [--json]
larecode sessions search <query> [--json] [--limit <n>]
larecode sessions export <id> [--format json|markdown]
larecode sessions rewind <id> <count> [--yes]
larecode sessions prune [--older-than <days>] [--keep <n>] [--json]
larecode sessions rm <id>
```

`show` prints a transcript, `search` matches across saved transcripts, and `export` writes a redacted copy. `rewind` truncates to an earlier message count and requires `--yes` before dropping messages. `prune` deletes by age or keeps only the newest count. `rm` deletes the session, its checkpoints, and any share links that point at it. Session ids are the file names under `~/.larecode/sessions`.

## larecode setup

Write an initial config for your provider. With no options in a terminal, it asks for the provider, base URL, model, and API key, then saves the result. Passing any option skips the prompts for scripted setup.

```text
--provider <name>  provider name
--type <type>      openai-compatible, anthropic, ollama, openrouter, zai, or custom
--base-url <url>   provider base url
--api-key <key>    api key for the provider
--model <model>    default model
--force            overwrite an existing config
```

## larecode doctor

Check configuration, provider auth, model catalog, a streaming probe, permissions, and instruction files. Takes no options. Exits non-zero when a problem is found.

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

## larecode skill

Author a reusable skill from a completed session, install skills shared by others, and list what is discovered.

```text
larecode skill author <session-id> [--provider <name>] [--model <name>] [--json]
larecode skill install <source> [--json]
larecode skill list [--json]
```

The session needs at least four user/assistant turns and three tool calls. The command asks the selected model for a name, description, and body, then writes `.larecode/skills/<name>/SKILL.md` with `state: draft`. Review it and change the state to `active` when it is ready.

`install` copies skills from a git URL or a local directory into `~/.larecode/skills/`, skipping names that already exist. `list` shows each discovered skill with its `state/approval` status.

## larecode completion

Print a completion script for your shell. Add it to your shell profile or source it directly.

```bash
larecode completion bash >> ~/.bashrc
larecode completion zsh > "${fpath[1]}/_larecode"
larecode completion fish > ~/.config/fish/completions/larecode.fish
```

Supported shells: `bash`, `zsh`, and `fish`. The script completes top-level commands and the `sessions`, `mcp`, and `cron` subcommands.

## larecode acp

Speak Agent Client Protocol over stdio for editors such as Zed. Takes no options.
