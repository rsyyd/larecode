export const VERSION = "0.0.0";

export { AgentLoop } from "./agent/loop.js";
export type { AgentLoopOptions, AgentLoopCallbacks } from "./agent/loop.js";

export { Providers } from "./provider/provider.js";
export type {
  ProviderAdapter,
  ProviderCapabilities,
  ModelInfo,
  CompletionOptions,
} from "./provider/provider.js";

export { Tools } from "./tool/tool.js";
export type { Tool, ToolCall, ToolResult, ToolContext, ToolSchema } from "./tool/tool.js";

export { Permissions } from "./permission/permission.js";
export type {
  PermissionGroup,
  PermissionMode,
  PermissionPolicy,
  PermissionDecision,
} from "./permission/permission.js";

export { Sessions } from "./session/session.js";
export type { Session, SessionMetadata, SessionMessage } from "./session/session.js";

export { Memory } from "./memory/memory.js";
export type { MemoryTier, MemoryEntry } from "./memory/memory.js";

export { configPath, defaultConfig, loadConfig, saveConfig } from "./config/config.js";
export type { Config, ProviderConfig } from "./config/config.js";

export { LSP } from "./lsp/lsp.js";
export type { LSPCapabilities, SymbolInfo } from "./lsp/lsp.js";

export { MCP } from "./mcp/mcp.js";
export type { MCPServerConfig, MCPTool } from "./mcp/mcp.js";

export { Skills } from "./skill/skill.js";
export type { Skill, SkillMetadata, SkillState } from "./skill/skill.js";

export { Hooks } from "./hook/hook.js";
export type { Hook, HookContext, HookType } from "./hook/hook.js";

export { Context } from "./context/context.js";
export type { ContextQuery, ContextResult, RelevanceScore } from "./context/context.js";