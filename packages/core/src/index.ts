export const VERSION = '0.0.0';

export { AgentLoop } from './agent/loop.js';
export type { AgentLoopOptions, AgentLoopCallbacks } from './agent/loop.js';

export { Providers } from './provider/provider.js';
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
  providersFromConfig,
  type OpenAIAdapterOptions,
} from './provider/openai-adapter.js';

export { Tools } from './tool/tool.js';
export type { Tool, ToolCall, ToolResult, ToolContext, ToolSchema } from './tool/tool.js';

export { Permissions } from './permission/permission.js';
export type {
  PermissionGroup,
  PermissionMode,
  PermissionPolicy,
  PermissionDecision,
} from './permission/permission.js';

export { Sessions } from './session/session.js';
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
export type { LSPCapabilities, SymbolInfo } from './lsp/lsp.js';

export { MCP } from './mcp/mcp.js';
export type { MCPServerConfig, MCPTool } from './mcp/mcp.js';

export { Skills } from './skill/skill.js';
export type { Skill, SkillMetadata, SkillState } from './skill/skill.js';

export { Hooks } from './hook/hook.js';
export type { Hook, HookContext, HookType } from './hook/hook.js';

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
  DEFAULT_MODEL_PRICING,
  type TokenUsage,
  type CostUsage,
  type UsageSnapshot,
  type UsageAggregate,
  type UsageRecorder,
} from './usage/usage.js';
