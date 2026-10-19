import type { ExecutionBackend } from '../exec/backend.js';
import type { Tool } from './tool.js';
import { astGrepTool } from './astgrep.js';
import { bashTool } from './bash.js';
import { browserTool } from './browser.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { patchTool } from './patch.js';
import { readTool } from './read.js';
import { sessionSearchTool } from './session-search.js';
import { webFetchTool, webSearchTool } from './web.js';
import { writeTool } from './write.js';

export function coreTools(options: { backend?: ExecutionBackend } = {}): Tool[] {
  return [
    readTool(),
    writeTool(),
    editTool(),
    bashTool(options.backend),
    globTool(),
    grepTool(),
    astGrepTool(),
    patchTool(),
    webFetchTool(),
    webSearchTool(),
    browserTool(),
    sessionSearchTool(),
  ];
}
