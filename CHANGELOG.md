# Changelog

## Unreleased (M1)

- T-05: Anthropic, Ollama, OpenRouter, and Z.ai adapters with capability metadata: Anthropic messages API with SSE events, Ollama `/api/chat` NDJSON streaming and `/api/tags` catalog, OpenRouter/Z.ai via the OpenAI-compatible adapter with attribution headers, per-provider capability defaults, model-id capability heuristics, and a shared contract test suite across all adapters.
- T-04: provider abstraction and OpenAI-compatible adapter: ModelInfo catalog with capabilities, complete and streamComplete with SSE parsing, models endpoint fetch with catalog fallback, model hot-swap, and config-based adapter instantiation.

## Unreleased (M0)

- T-03: logging, error taxonomy, usage accounting skeleton: structured logger with pluggable handlers and child contexts, typed LumpsError taxonomy with categories and serialization, and in-memory UsageRecorder with token and cost estimation per model and conversation.
- UI rule (PRD FR-2/§7): UI chrome is emoji-free: text-presentation glyphs only (`●` `⎿` `❯` `»` `✓` `✗` `?` `~`); emoji may appear only inside model-generated content. Appendix A mockups updated to the glyph set: `>` user, `●` agent turn, `⎿` tool result.

- T-02: config system: global `~/.lumpscode/config.json` (0600) with project `lumpscode.json` overrides, validation, instruction-file discovery with hash-bound consent (`AGENTS.md`, `LUMPCODE.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`), and the `lumpscode doctor` command. `LUMPSCODE_HOME` overrides the config directory for tests and sandboxes.
- T-01: monorepo scaffold: Bun workspaces, TypeScript strict, oxlint, prettier, vitest, GitHub Actions CI, hello-world binary. Core ships agent/provider/tool/permission/session/memory/config/lsp/mcp/skill/hook/context modules; permission engine is functional with tests.
- Naming pass: modules follow opencode conventions: domain-named files, plural facade classes, config as plain functions.
