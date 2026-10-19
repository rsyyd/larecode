# External tech adoption for LareCode

> **Sources**: web search, GitHub REST API via `gh api repos/<owner>/<repo>` (license, stars, last push), `npm view` (package license, version), retrieved **2026-10-18**; local inspection of `/root/hermes-agent` as the project feature reference. Star counts are rounded. Vendor-published benchmark numbers are labeled as such.

Scan driven by four goals: broad capability access, agent accuracy (facts over guesses), humanized output (no AI slop), token efficiency. Each section ends with the adoption for the matching PRD task.

## 1. Capability access: MCP ecosystem

- Client foundation: `@modelcontextprotocol/sdk` (MIT, v1.32.1 on npm). This is the reference implementation maintained by the protocol authors.
- Preset servers that add capability the native tools do not have:
  - **context7** (MIT, ~63k stars): version-specific library documentation lookup. Direct anti-hallucination lever for API usage.
  - **playwright-mcp** (Apache-2.0, ~38k stars): browser automation over accessibility snapshots.
  - **serena** (~30k stars, license not OSI-declared on the API; README states GPL-3.0-or-later): semantic code toolkit over LSP. Safe to run as an external MCP process across the protocol boundary; do not copy code into the MIT core.
- The official server collection (`modelcontextprotocol/servers`, ~91k stars) works as a catalog to point users at. Filesystem, fetch, git, and memory servers duplicate native tools and are worth loading only on demand.

**Adoption (T-14):** build on `@modelcontextprotocol/sdk`; ship context7 and playwright as documented presets, serena as an optional preset.

## 2. Accuracy: code intelligence

- **LSP client (T-13).** serena is the best public design reference: symbol-first tool surface (definitions, references, symbols, hover), token-lean formatted results instead of raw JSON, graceful degrade when no language server exists. Design reference only (GPL); the client is our own implementation.
- **Repo map (T-18).** aider's repo-map (Apache-2.0) parses the tree with tree-sitter, ranks symbols with PageRank over a reference graph, and renders a map inside a ~1k token budget. A language-agnostic answer to "what matters in this repo" without dumping files. `TusharKarkera22/RepoMap-AI` (no license declared) shows the same idea as an MCP server; pattern only.
- **Structural search and edit (T-18).** `@ast-grep/napi` (MIT, v0.51.0) provides AST-pattern search and rewriting with prebuilt bindings; `web-tree-sitter` (MIT, v0.27.1) covers bare parsing. AST queries beat regex for symbol-aware work and make codemods safer than text replacement.
- **Docs grounding.** context7 (section 1) is the runtime complement: look up the library version in use before writing calls against it.
- **Method codified.** superpowers (section 6) ships `systematic-debugging` (root cause before fixes) and `verification-before-completion`; both map onto the behavior the existing `--verify` flow (T-12) starts.

## 3. Humanized output (anti slop)

- **blader/humanizer** (MIT, ~58k stars) is the canonical anti-slop skill: a SKILL.md distilled from Wikipedia's _Signs of AI writing_ (em-dash overuse, "not just X, but Y", forced rule-of-three, promotional tone, inflated transitions). Ports with the same lineage: `doctorzorro/humanize-writing` (MIT), `aihxp/humanizer` (MIT).
- The reference agent already on this machine ships one: `/root/hermes-agent/skills/creative/humanizer`. Hermes is the stated feature reference for LareCode, so its phrasing rules are the base to adapt.
- Application points: commit messages, PR bodies, docs, and user-facing replies. TUI chrome rules (FR-2) already cover the terminal surface.

**Adoption (T-16):** bundle an adapted humanizer skill and apply its rules whenever the agent writes prose.

## 4. Token efficiency

### Prompt caching

- Measured impact: 41 to 80% input cost reduction and 13 to 31% time-to-first-token improvement across providers (arXiv 2601.06007, "Don't Break the Cache"; LangChain Deep Agents eval reports 49 to 80% on real agent trajectories).
- Provider mechanics: Anthropic caches explicit `cache_control` breakpoints (reads at 10% of input price, 5-minute or 1-hour TTL); OpenAI caches automatically at prefixes of 1024+ tokens.
- Prompt discipline, which is the bigger half: stable prefix order (system prompt, tool definitions, history), no timestamps or other volatile text in the system prompt, fixed tool ordering, dynamic content at the end. Track `cache_read_input_tokens` to verify hits.

**Adoption (agent loop, T-28):** enforce cache-safe prompt ordering in the loop and providers; surface cache-read metrics in usage tracking.

### Compaction (FR-11)

- Lightest touch first: clear stale tool results (Anthropic's context management).
- Threshold-based summary: reserve ~16k tokens, keep the recent ~20k tokens verbatim (pi coding agent defaults); summarize with a structured template (decisions, unresolved bugs, current state, next steps) as Claude Code does.
- CliffCompaction (arXiv 2609.26779): never compact a compaction. Discard prior compacted output and summarize from the raw window to prevent context drift.
- Deep Agents exposes compaction as a model-invoked tool so the agent compacts at task boundaries instead of at the context ceiling. Prompting alone rarely triggers this; keep it for a later pass.

### Command output filters

- rtk (`rtk-ai/rtk`, Apache-2.0, ~84k stars) compresses CLI output per command family (git, test runners, package managers, linters) with documented reductions of 20 to 90% per command, tracked in SQLite.
- The valuable half is the filter set, not the proxy: a native subset in the bash tool (status/diff compression, test summary extraction, install noise stripping) removes the same tokens without a new dependency. The `--verify` parser (T-12) already does this shape of work for test runs.

### Progressive disclosure

- agentskills.io budgets skill metadata at ~50 to 100 tokens at load time, with the body loaded on demand (T-16). The repo map stays inside its own ~1k token budget (T-18). Both exist to keep the stable prefix small, which compounds with caching.

## 5. Memory

- **mem0** (Apache-2.0, ~67k stars) is the pattern to copy: an LLM pass extracts durable facts, retrieval returns a small top-k set (vendor benchmarks: LongMemEval 94.4, LoCoMo 92.5, under 7k tokens per retrieval). It is a Python runtime, so adopt the pattern inside core instead of vendoring it.
- Skip: **Zep** Community Edition is deprecated (April 2025) and cloud entry sits around $125/month; **Letta** (formerly MemGPT) is a full agent framework, not a memory layer; **basic-memory** is AGPL-3.0.
- The T-11 JSON store stays the substrate. Cross-session FTS search (T-22) can follow the Hermes approach in `/root/hermes-agent/hermes_state_fts.py` (SQLite FTS tables alongside session state).

**Adoption (T-19):** a fact-extraction pass writing to the project/user tiers, retrieval scoped and budgeted top-k. No new runtime dependency.

## 6. Skills ecosystem

- agentskills.io SKILL.md (frontmatter, discovery dirs, progressive disclosure) already matches FR-8.
- **obra/superpowers** (MIT, ~301k stars) is a methodology pack, not tooling. Default-bundle candidates, in the order they matter here: `systematic-debugging`, `verification-before-completion`, `test-driven-development`, `brainstorming`, `writing-plans`, `executing-plans`, `requesting-code-review`, `receiving-code-review`, `writing-skills`. All are text skills with no runtime coupling.
- `vercel-labs/skills` (MIT, ~35k stars, `npx skills`) is format-compatible and worth referencing later for third-party skill installation (T-31 territory, not T-16).

**Adoption (T-16):** ship the superpowers subset plus humanizer as default skills, loaded through progressive disclosure.

## Adoption map

| Task       | Adoption                                                                                             | License position                          |
| ---------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| T-13       | serena architecture as design reference (symbol tools, lean output, graceful degrade)                | GPL reference only, no code porting       |
| T-14       | `@modelcontextprotocol/sdk` (MIT); presets: context7, playwright, serena (optional)                  | MIT / Apache-2.0 / GPL across MCP process |
| T-16       | superpowers subset plus humanizer as default skills; progressive disclosure budgets                  | MIT                                       |
| T-18       | tree-sitter + PageRank repo map (~1k token budget), ast-grep structural search, compaction per FR-11 | MIT                                       |
| T-19       | mem0-style fact extraction with token-lean retrieval; existing store as substrate                    | pattern only                              |
| T-21       | playwright-mcp preset for browser automation                                                         | Apache-2.0                                |
| Loop, T-28 | cache-safe prompt ordering (stable prefix, no timestamps, fixed tool order), cache-read metrics      | provider feature                          |

## License guardrails

- GPL-3.0-or-later (serena): external process or read-only reference. No code copied into the MIT core.
- AGPL-3.0 (basic-memory): avoided entirely.
- Python runtimes (mem0, letta): patterns adopted, not dependencies.
- Every npm package listed here is MIT at the version checked: MCP SDK 1.32.1, ast-grep 0.51.0, web-tree-sitter 0.27.1.

## Source table

| repo                               | license                    | stars (approx) | last push  | role                           |
| ---------------------------------- | -------------------------- | -------------- | ---------- | ------------------------------ |
| oraios/serena                      | GPL-3.0 (API: NOASSERTION) | 30k            | 2026-10-15 | LSP tool design reference      |
| Aider-AI/aider                     | Apache-2.0                 | 50k            | 2026-05-22 | repo-map algorithm reference   |
| TusharKarkera22/RepoMap-AI         | none declared              | <1k            | 2026-03-30 | repo-map MCP, pattern only     |
| ast-grep/ast-grep                  | MIT                        | 16k            | 2026-10-15 | structural search and rewrite  |
| upstash/context7                   | MIT                        | 63k            | 2026-10-17 | versioned docs lookup          |
| microsoft/playwright-mcp           | Apache-2.0                 | 38k            | 2026-10-16 | browser automation             |
| modelcontextprotocol/servers       | mixed                      | 91k            | 2026-10-13 | server catalog                 |
| obra/superpowers                   | MIT                        | 301k           | 2026-10-10 | methodology skills             |
| blader/humanizer                   | MIT                        | 58k            | 2026-10-16 | anti-slop skill                |
| rtk-ai/rtk                         | Apache-2.0                 | 84k            | 2026-10-17 | output-filter reference        |
| mem0ai/mem0                        | Apache-2.0                 | 67k            | 2026-10-17 | memory pattern                 |
| letta-ai/letta                     | Apache-2.0                 | 25k            | 2026-09-10 | skipped (framework)            |
| getzep/zep                         | Apache-2.0                 | 5k             | 2026-10-14 | skipped (CE deprecated)        |
| basicmachines-co/basic-memory      | AGPL-3.0                   | 4k             | 2026-10-16 | skipped (license)              |
| vercel-labs/skills                 | MIT                        | 35k            | 2026-10-09 | skill install format reference |
| coleam00/context-engineering-intro | MIT                        | 14k            | 2026-03-16 | context engineering primer     |

## Reading list

- Anthropic, _Effective context engineering for AI agents_ (compaction, tool-result clearing, note-taking).
- arXiv 2601.06007, _Don't Break the Cache_ (agentic prompt caching evaluation).
- arXiv 2609.26779, _CliffCompaction_ (compaction without drift).
- LangChain, _Autonomous context compression_ and _Prompt Caching with Deep Agents_.
- earendil-works/pi, `packages/coding-agent/docs/compaction.md` (reserve 16k, keep 20k).
