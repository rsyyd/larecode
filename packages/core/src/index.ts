export const VERSION = '0.0.0';

export { AgentLoop } from './agent/loop.js';
export type { AgentLoopOptions, AgentLoopCallbacks, HaltReason } from './agent/loop.js';
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
export type {
  ProviderAdapter,
  ProviderCapabilities,
  ModelInfo,
  CompletionOptions,
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
export { taskTool } from './tool/task.js';
export type { TaskToolOptions } from './tool/task.js';

export { Permissions } from './permission/permission.js';
export type {
  PermissionGroup,
  PermissionMode,
  PermissionPolicy,
  PermissionDecision,
  PermissionCheckContext,
} from './permission/permission.js';
export { AuditLog, fileAuditSink } from './permission/audit.js';
export type { AuditEntry, AuditSink, AuditInput } from './permission/audit.js';
export { redactSecrets, redactValue } from './permission/redact.js';

export { Sessions, renderSessionContext, sessionsDir } from './session/session.js';
export type { Session, SessionMetadata, SessionMessage } from './session/session.js';

export { Memory } from './memory/memory.js';
export type { MemoryTier, MemoryEntry } from './memory/memory.js';

export {
  lumpscodeHome,
  configPath,
  projectConfigPath,
  defaultConfig,
  loadConfig,
  loadEffectiveConfig,
  validateConfig,
  saveConfig,
} from './config/config.js';
export type { Config, ProviderConfig } from './config/config.js';

export { LSP } from './lsp/lsp.js';
export type { LSPCapabilities, LSPOptions, SymbolInfo } from './lsp/lsp.js';
export { lspTool } from './tool/lsp.js';

export { MCP } from './mcp/mcp.js';
export type { MCPServerConfig, MCPTool } from './mcp/mcp.js';
export { mcpTools } from './mcp/tools.js';

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

export { Context } from './context/context.js';
export type { ContextQuery, ContextResult, RelevanceScore } from './context/context.js';

export {
  INSTRUCTION_FILES,
  consentPath,
  consentToFile,
  discoverInstructions,
  hashFile,
} from './context/instructions.js';
export type { InstructionFile, InstructionStatus } from './context/instructions.js';

export {
  Logger,
  defaultLogger,
  createConsoleHandler,
  type LogLevel,
  type LogEntry,
  type LogHandler,
} from './logger/logger.js';

export {
  LumpsError,
  isLumpsError,
  assertLumpsError,
  type ErrorCode,
  type LumpsErrorJSON,
} from './error/error.js';

export {
  InMemoryUsageRecorder,
  createUsageRecorder,
  estimateCost,
  estimateTokens,
  DEFAULT_MODEL_PRICING,
  type TokenUsage,
  type CostUsage,
  type UsageSnapshot,
  type UsageAggregate,
  type UsageRecorder,
} from './usage/usage.js';
