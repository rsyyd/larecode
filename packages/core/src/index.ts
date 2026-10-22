export { VERSION } from './version.js';

export type { HaltReason } from './agent/loop.js';
export { ChatSession } from './agent/chat.js';
export type {
  ChatAgentName,
  ChatEvent,
  ChatPermissionConfirm,
  ChatPermissionRequest,
  ChatRunOptions,
  ChatSessionOptions,
} from './agent/chat.js';
export { DefaultAgentRuntime, createSubagents, isAgentRuntimeStopEvent } from './agent/runtime.js';
export { AgentRuntimeLoop } from './agent/runtime-loop.js';
export type { AgentRuntimeLoopOptions } from './agent/runtime-loop.js';
export type {
  AgentCheckpointSink,
  AgentRuntime,
  AgentRuntimeAgentName,
  AgentRuntimeEvent,
  AgentRuntimeHaltReason,
  AgentRuntimeOptions,
  AgentRuntimePermissionConfirm,
  AgentRuntimePermissionRequest,
  AgentRuntimeStopEvent,
  AgentRuntimeTurnInput,
} from './agent/runtime.js';
export { BUILTIN_AGENTS, toolsForAgent } from './agent/agents.js';
export type { AgentDefinition, AgentName } from './agent/agents.js';
export { Subagents, compressResult, SUBAGENT_DEFAULTS } from './agent/subagent.js';
export type {
  SubagentLoopLike,
  SubagentResult,
  SubagentRunOptions,
  SubagentsOptions,
} from './agent/subagent.js';

export { Providers, providersFromConfig } from './provider/provider.js';
export type { LareCodeFetch } from './provider/fetch.js';
export type {
  ProviderAdapter,
  ProviderCapabilities,
  ModelInfo,
  CompletionOptions,
  ProviderMessage,
  ProviderMessageRole,
  ProviderStreamEvent,
  ProviderToolCall,
  ProviderUsage,
  ToolSpec,
} from './provider/provider.js';
export {
  OpenAIAdapter,
  openAIAdapterFromConfig,
  type OpenAIAdapterOptions,
} from './provider/openai-adapter.js';
export {
  AnthropicAdapter,
  anthropicAdapterFromConfig,
  type AnthropicAdapterOptions,
} from './provider/anthropic-adapter.js';
export {
  OllamaAdapter,
  ollamaAdapterFromConfig,
  type OllamaAdapterOptions,
} from './provider/ollama-adapter.js';
export {
  PROVIDER_CAPABILITIES,
  capabilitiesFor,
  modelCapabilities,
} from './provider/capabilities.js';

export { Tools } from './tool/tool.js';
export type { Tool, ToolCall, ToolResult, ToolContext, ToolSchema } from './tool/tool.js';
export { coreTools } from './tool/core.js';
export type { CoreToolOptions } from './tool/core.js';
export { taskTool } from './tool/task.js';
export type { TaskToolOptions } from './tool/task.js';

export {
  Permissions,
  PERMISSION_GROUPS,
  NEVER_AUTO_APPROVED,
  assertPreAuthorizable,
} from './permission/permission.js';
export type {
  PermissionGroup,
  PermissionMode,
  PermissionPolicy,
  PermissionDecision,
  PermissionCheckContext,
} from './permission/permission.js';
export {
  AuditLog,
  auditPath,
  fileAuditSink,
  hashChainAuditSink,
  readAuditLog,
  verifyAuditLog,
} from './permission/audit.js';
export type {
  AuditEntry,
  AuditSink,
  AuditInput,
  AuditVerifyResult,
  ChainedAuditLine,
} from './permission/audit.js';
export { TOOL_PERMISSION_GROUPS, toolPermissionGroup } from './permission/tool-groups.js';
export { redactSecrets, redactValue } from './permission/redact.js';

export {
  LocalBackend,
  DockerBackend,
  SshBackend,
  backendFromConfig,
  runProcess,
  dockerArgs,
  sshArgs,
  shellQuote,
} from './exec/backend.js';
export type { ExecRequest, ExecResult, ExecutionBackend, ExecutionConfig } from './exec/backend.js';

export { Jobs, cronPath, cronPermissions, CRON_OUTPUT_MAX_CHARS } from './cron/job.js';
export type { CronJob, CronJobInput, CronResult } from './cron/job.js';
export { parseSchedule, nextRun, CRON_LOOKAHEAD_DAYS } from './cron/schedule.js';
export type { CronSpec } from './cron/schedule.js';
export { runCronJob, runScheduler } from './cron/runner.js';
export type { CronLoop, CronRunDeps, SchedulerDeps } from './cron/runner.js';

export {
  Sessions,
  renderSessionContext,
  sessionsDir,
  toProviderHistory,
} from './session/session.js';
export type { Session, SessionMetadata, SessionMessage } from './session/session.js';
export { FileSessionStore, MemorySessionStore } from './session/store.js';
export type { SessionStore } from './session/store.js';
export {
  searchSessions,
  searchHistory,
  renderHistoryDigest,
  SESSION_SEARCH_LIMIT,
  SESSION_SEARCH_MAX_LIMIT,
} from './session/search.js';
export type {
  SessionSearchHit,
  SessionSearchOptions,
  SearchHistoryOptions,
  HistorySummary,
} from './session/search.js';

export {
  Checkpoints,
  Worktrees,
  checkpointsDir,
  removeSessionCheckpoints,
  worktreesDir,
} from './checkpoint/checkpoint.js';
export type {
  CheckpointInfo,
  CheckpointOptions,
  RewindResult,
  WorktreeInfo,
  WorktreeOptions,
} from './checkpoint/checkpoint.js';

export {
  Memory,
  extractFacts,
  memoryDir,
  renderEntries,
  renderEntry,
  MAX_EXTRACTED_FACTS,
  MEMORY_BUDGET_TOKENS,
} from './memory/memory.js';
export type {
  MemoryTier,
  MemoryEntry,
  MemoryFact,
  MemoryOptions,
  RetrieveOptions,
} from './memory/memory.js';
export { MemoryCurator, CURATE_EVERY_TURNS } from './memory/curator.js';
export type { CuratorOptions } from './memory/curator.js';

export {
  larecodeHome,
  configPath,
  projectConfigPath,
  defaultConfig,
  loadConfig,
  loadEffectiveConfig,
  validateConfig,
  saveConfig,
  CONFIG_SCHEMA_VERSION,
} from './config/config.js';
export type {
  Config,
  ContextConfig,
  FallbackTarget,
  ProviderConfig,
  WebSearchConfig,
} from './config/config.js';

export { LSP } from './lsp/lsp.js';
export type { LSPCapabilities, LSPOptions, SymbolInfo } from './lsp/lsp.js';
export { lspTool } from './tool/lsp.js';
export { sessionSearchTool } from './tool/session-search.js';

export { MCP } from './mcp/mcp.js';
export type { MCPServerConfig, MCPTool } from './mcp/mcp.js';
export { connectMcpTools, mcpTools } from './mcp/tools.js';
export type { McpToolset } from './mcp/tools.js';
export { McpTrust, mcpFingerprint, mcpTrustPath } from './mcp/trust.js';
export type { McpTrustData, McpTrustEntry } from './mcp/trust.js';
export { MCP_PRESETS, MCP_PRESET_NAMES } from './mcp/presets.js';

export {
  Skills,
  discoverSkills,
  parseSkillFile,
  consentToSkill,
  skillConsentPath,
  SKILL_FILE,
  SKILL_CATALOG_MAX_CHARS,
  SKILL_BODY_MAX_CHARS,
} from './skill/skill.js';
export type {
  Skill,
  SkillMetadata,
  SkillState,
  SkillStatus,
  DiscoveredSkill,
  SkillsOptions,
} from './skill/skill.js';
export { skillTool } from './tool/skill.js';
export {
  authorSkill,
  isComplexTask,
  renderSkillDraft,
  skillDraftPath,
  slugifySkillName,
  transcriptOf,
  writeSkillDraft,
  COMPLEX_TASK_MIN_TURNS,
  COMPLEX_TASK_MIN_TOOL_CALLS,
  SKILL_NAME_RE,
  AUTHOR_TRANSCRIPT_MAX_CHARS,
} from './skill/author.js';
export type { SkillDraft, AuthorSkillOptions } from './skill/author.js';

export { Hooks } from './hook/hook.js';
export type { Hook, HookContext, HookType, HookDecision } from './hook/hook.js';

export { Plugins, discoverPlugins, pluginRoots, HOOK_TYPES } from './plugin/plugin.js';
export type {
  PluginApi,
  PluginInfo,
  PluginLoadReport,
  PluginManifest,
  PluginModule,
  PluginTrust,
  PluginsOptions,
} from './plugin/plugin.js';

export { Context, CONTEXT_BUDGET_TOKENS, CONTEXT_MAX_FILES } from './context/context.js';
export { evaluateRetrieval } from './context/eval.js';
export type { RetrievalCase, RetrievalCaseResult, RetrievalReport } from './context/eval.js';
export { CONTEXT_ALLOCATION, assembleContext } from './context/assembler.js';
export type {
  AssembledContext,
  ContextInputName,
  ContextSection,
  ContextSectionName,
  ContextSectionReport,
} from './context/assembler.js';
export { CONTEXT_HEADER, ContextBuilder, sanitizeContext } from './context/inject.js';
export type {
  ContextBuilderOptions,
  ContextReport,
  ContextSourceReport,
} from './context/inject.js';
export type { ContextQuery, ContextResult, RelevanceScore } from './context/context.js';
export {
  buildRepoMap,
  extractFileFacts,
  pageRank,
  resolveImport,
  REPO_MAP_BUDGET_TOKENS,
} from './context/repomap.js';
export type { FileFacts, SymbolFact, RepoMapOptions } from './context/repomap.js';
export {
  compactMessages,
  compactProviderMessages,
  estimateMessagesTokens,
  estimateProviderMessagesTokens,
  SUMMARY_MARKER,
  CLEARED_TOOL_RESULT,
} from './context/compact.js';
export type {
  CompactionOptions,
  CompactionResult,
  ProviderCompactionResult,
} from './context/compact.js';
export { astGrepTool, AST_GREP_LIMIT } from './tool/astgrep.js';
export {
  webFetchTool,
  webSearchTool,
  parseDuckDuckGo,
  htmlToText,
  decodeEntities,
  parseHttpUrl,
  assertPublicHttpUrl,
  isPrivateAddress,
  WEB_FETCH_MAX_CHARS,
  WEB_FETCH_MAX_REDIRECTS,
  WEB_SEARCH_LIMIT,
  WEB_SEARCH_MAX_LIMIT,
} from './tool/web.js';
export type { SearchResult, WebSearchOptions } from './tool/web.js';
export { browserTool, cdpEndpoint, DEFAULT_CDP_ENDPOINT, BROWSER_ACTIONS } from './tool/browser.js';

export {
  INSTRUCTION_BUDGET_CHARS,
  INSTRUCTION_FILES,
  consentPath,
  consentToFile,
  discoverInstructions,
  hashFile,
  loadInstructionContext,
} from './context/instructions.js';
export type {
  InstructionFile,
  InstructionStatus,
  InstructionContextOptions,
} from './context/instructions.js';

export {
  Logger,
  defaultLogger,
  createConsoleHandler,
  type LogLevel,
  type LogEntry,
  type LogHandler,
} from './logger/logger.js';

export {
  LareError,
  isLareError,
  assertLareError,
  type ErrorCode,
  type LareErrorJSON,
} from './error/error.js';

export {
  InMemoryUsageRecorder,
  createUsageRecorder,
  estimateCost,
  estimateTokens,
  applyTokenRatio,
  tokenRatio,
  formatCost,
  formatTokens,
  DEFAULT_MODEL_PRICING,
  type TokenUsage,
  type CostUsage,
  type UsageSnapshot,
  type UsageAggregate,
  type UsageRecorder,
} from './usage/usage.js';

export { Metrics, defaultMetrics } from './metrics/metrics.js';
export type { MetricsBucket, MetricsSnapshot } from './metrics/metrics.js';

export {
  createDebugBundle,
  environmentSummary,
  formatUsage,
  installCrashReporter,
  summarizeUsage,
  writeCrashReport,
  writeDebugBundle,
  writeFeedback,
} from './diagnostics/diagnostics.js';
export type { DebugBundle, UsageSummary } from './diagnostics/diagnostics.js';
