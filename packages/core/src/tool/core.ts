import type { Tool } from './tool.js';
import { bashTool } from './bash.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { patchTool } from './patch.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';

export function coreTools(): Tool[] {
  return [readTool(), writeTool(), editTool(), bashTool(), globTool(), grepTool(), patchTool()];
}
