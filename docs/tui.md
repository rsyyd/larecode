---
title: TUI
nav_order: 5
description: Keyboard-first chat interface for larecode
---

# TUI

`larecode chat` opens the terminal interface. It needs a real TTY; scripts should use `larecode run`.

## First run

```bash
larecode setup
larecode doctor
larecode chat
```

If no config exists, `chat` prints a hint and starts with the built-in defaults. Run `setup` first so the first turn reaches a provider you can actually use.

## Keys

| Key               | Action                                         |
| ----------------- | ---------------------------------------------- |
| `Enter`           | Send the prompt                                |
| `Ctrl+J`          | Insert a newline                               |
| `Esc`             | Stop the current turn and clear queued prompts |
| `Ctrl+C`          | Quit when idle; stop the turn when streaming   |
| `Tab`             | Toggle `plan` and `build` agents               |
| `PageUp/PageDown` | Scroll the transcript                          |
| `Up/Down`         | Move in a picker or command palette            |
| `@general`        | Route the turn to the general subagent         |

Messages sent while a turn is streaming are queued and run in order. The prompt shows `+N queued`; `Esc` clears the queue.

## Slash commands

| Command              | Action                                                    |
| -------------------- | --------------------------------------------------------- |
| `/help`              | Show keybindings and commands                             |
| `/new`               | Start a fresh session                                     |
| `/sessions`          | Pick a saved session and resume it                        |
| `/status`            | Show agent, provider/model, tokens, cost, and queue depth |
| `/model`             | Pick a model, or `/model <provider> <model>`              |
| `/theme dark\|light` | Switch theme; light theme meets WCAG AA contrast          |
| `/context`           | Show the context budget and its sources                   |
| `/clear`             | Clear the visible transcript                              |
| `/exit`              | Quit                                                      |

The command palette opens as soon as the input starts with `/`. `Tab` completes the highlighted command.

## Terminal support

| Environment   | Status                                                             |
| ------------- | ------------------------------------------------------------------ |
| Linux / macOS | Primary target, covered by the full test suite                     |
| Termux        | Primary target; use a monospace font and `larecode run` in scripts |
| tmux          | Smoke-tested in CI at 80×24 and after a resize to 40 columns       |
| Windows       | Use WSL for the full TUI; the npm package runs on Windows          |

The tmux smoke test starts a session, streams a mocked turn, and resizes the window. Run it locally with:

```bash
bun run test:tmux
```

Termux is not emulated in CI. The release checklist includes a manual Termux pass.

## Themes and accessibility

`/theme light` and `/theme dark` switch palettes at runtime. Both palettes keep text at WCAG AA contrast; `packages/tui/src/theme.test.ts` enforces the ratios. See [Accessibility](accessibility.md) for the keyboard-only audit.
