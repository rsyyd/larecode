import type { ExecutionBackend } from '../exec/backend.js';
import type { LSP } from '../lsp/lsp.js';
import type { Skills } from '../skill/skill.js';
import type { Subagents } from '../agent/subagent.js';
import type { Tool } from './tool.js';
import { astGrepTool } from './astgrep.js';
import { bashTool } from './bash.js';
import { browserTool } from './browser.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { lspTool } from './lsp.js';
import { patchTool } from './patch.js';
import { readTool } from './read.js';
import { sessionSearchTool } from './session-search.js';
import { skillTool } from './skill.js';
import { taskTool } from './task.js';
import { webFetchTool, webSearchTool, type WebSearchOptions } from './web.js';
import { writeTool } from './write.js';

export interface CoreToolOptions {
  backend?: ExecutionBackend;
  lsp?: LSP;
  skills?: Skills;
  subagents?: Subagents;
  agent?: { provider: string; model: string };
  webSearch?: WebSearchOptions;
}

export function coreTools(options: CoreToolOptions = {}): Tool[] {
  const tools: Tool[] = [
    readTool(),
    writeTool(),
    editTool(),
    bashTool(options.backend),
    globTool(),
    grepTool(),
    astGrepTool(),
    patchTool(),
    webFetchTool(),
    webSearchTool(options.webSearch),
    browserTool(),
    sessionSearchTool(),
  ];
  if (options.lsp) tools.push(lspTool(options.lsp));
  if (options.skills) tools.push(skillTool(options.skills));
  if (options.subagents && options.agent) {
    tools.push(taskTool(options.subagents, options.agent));
  }
  return tools;
}
