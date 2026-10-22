---
title: Extensions
nav_order: 9
description: Skills, subagents, and plugins
---

# Extensions

Three ways to extend Lare Code without changing the core: skills, subagents, and plugins.

## Skills

A skill is a directory with a `SKILL.md` file:

```markdown
---
name: release-notes
description: Turn merged pull requests into release notes
version: 1
---

Read the commits since the last tag, group them by type, and write short notes.
```

Searched in order:

1. `.larecode/skills/` in the project
2. `.agents/skills/` in the project
3. `~/.larecode/skills/`

Project skills are untrusted input. They start as `pending`; the first load asks for consent and records the file hash in `~/.larecode/skill-consent.json`. Editing the file revokes consent, and loading asks again. The catalog is capped at 1,200 characters; a loaded body is capped at 8,000. The model can only load a skill body through the `skill` tool, which checks the `skills` permission group.

## Subagents

The `task` tool runs an isolated agent loop with its own budget:

```json
{
  "description": "audit the parser",
  "prompt": "Review src/parser.ts for unchecked input. Report only findings.",
  "agent": "general"
}
```

A subagent gets the same working directory and permission engine but a fresh history. It defaults to 12 iterations, 50,000 tokens, and 120 seconds, and its result is compressed to 800 tokens before returning to the parent. Depth and concurrency are capped (depth 1, two at a time by default), so a subagent cannot spawn an unbounded tree. The `task` tool requires the `subagent` permission group.

In the TUI, prefix a prompt with `@general` to route the turn to the general subagent.

## Plugins

A plugin is a directory with `plugin.json` and an entry module:

```json
{
  "name": "audit-guard",
  "version": "0.1.0",
  "entry": "index.mjs"
}
```

A trusted in-process plugin exports `activate(api)` and registers hooks:

```js
export function activate(api) {
  api.registerHook('pre-tool', (context) => {
    if (
      context.call?.name === 'bash' &&
      String(context.call.arguments.command).includes('rm -rf')
    ) {
      return { block: true, reason: 'destructive command' };
    }
  });
}
```

Hook types are `pre-tool`, `post-tool`, `session-start`, and `session-end`. A handler can return `{ block: true, reason }`; a `pre-tool` block becomes a denied tool result. A thrown handler fails closed for `pre-tool` and is logged for other events.

Trust follows the directory:

- `~/.larecode/plugins/` is trusted and runs in process.
- `<project>/.larecode/plugins/` is untrusted. It runs out of process through a JSON-line harness, so a crash or infinite loop does not take down the agent. It still executes code from the repository, so only install project plugins you have reviewed.

The loader and hook engine ship in `@larecode/core` and are covered by tests. The CLI does not auto-load plugins yet; `docs/claims.md` records that gap. Library callers can opt in:

```ts
import { Hooks, Plugins } from '@larecode/core';

const hooks = new Hooks();
const plugins = new Plugins({ projectDir: process.cwd() });
const report = await plugins.load(hooks);
// pass `hooks` to the tool registry or runtime, then close plugins when done
```

## See also

- [Tools](tools.md) for the built-in tool list.
- [Permissions](permissions.md) for the groups extensions use.
- [MCP](mcp.md) for external tool servers.
