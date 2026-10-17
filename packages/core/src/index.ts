export const VERSION = '0.0.0';

export { AgentLoop } from './agent/loop.js';
export type { AgentLoopOptions, AgentLoopCallbacks } from './agent/loop.js';

export { ProviderRegistry } from './providers/registry.js';
export type {
  ProviderAdapter,
  ProviderCapabilities,
  ModelInfo,
  CompletionOptions,
} from './providers/registry.js';

export { ToolRegistry } from './tools/registry.js';
export type { Tool, ToolCall, ToolResult, ToolContext, ToolSchema } from './tools/registry.js';

export { PermissionEngine } from './permissions/engine.js';
export type {
  PermissionGroup,
  PermissionMode,
  PermissionPolicy,
  PermissionDecision,
} from './permissions/engine.js';

export { SessionManager } from './session/manager.js';
export type { Session, SessionMetadata, SessionMessage } from './session/manager.js';

export { MemoryStore } from './memory/store.js';
export type { MemoryTier, MemoryEntry } from './memory/store.js';

export { ConfigManager } from './config/manager.js';
export type { Config, ProviderConfig } from './config/manager.js';

export { LSPClient } from './lsp/client.js';
export type { LSPCapabilities, SymbolInfo } from './lsp/client.js';

export { MCPClient } from './mcp/client.js';
export type { MCPServerConfig, MCPTool } from './mcp/client.js';

export { SkillManager } from './skills/manager.js';
export type { Skill, SkillMetadata, SkillState } from './skills/manager.js';

export { HookManager } from './hooks/manager.js';
export type { Hook, HookContext, HookType } from './hooks/manager.js';

export { ContextEngine } from './context/engine.js';
export type { ContextQuery, ContextResult, RelevanceScore } from './context/engine.js';
