---
title: Accessibility
nav_order: 18
description: How the TUI and CLI support keyboard-only and low-vision use
---

# Accessibility

The terminal UI is keyboard-driven and themeable. The design rules:

## Contrast

The dark and light themes use tokens, not raw colors. Text and background pairs must pass WCAG AA (or better) contrast, and the TUI status bar/states use both color and a glyph (`✓`/`✗`/`~`) so no state is color-only. Invalid or dim text is never the only signal for a blocking decision.

## Keyboard only

- Every action is reachable without a mouse: prompt input, queue drain, abort (Escape), `/` commands, model and session pickers, scrollback.
- Focus is visible via the cursor and selection styling; there is no invisible focus trap.

## Terminal compatibility

- Targets Linux, macOS, and Termux terminals; tmux sessions and Windows terminals are smoke-tested in CI.
- No mouse-required widgets; all pickers degrade to text input.
- Output stays scrollable; long tool results are truncated with a marker instead of flooding the viewport.

## Language

- All user-facing strings are plain English without emoji or decorative symbols; codes and paths are kept verbatim for copyability.

If a control fails keyboard-only usage or a color pair fails contrast, that is treated as a bug, not a feature gap.
