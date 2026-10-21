import type { PermissionGroup } from './permission.js';

export const TOOL_PERMISSION_GROUPS: Record<string, PermissionGroup> = {
  read: 'read',
  glob: 'read',
  grep: 'read',
  ast_grep: 'read',
  lsp: 'read',
  session_search: 'read',
  write: 'write',
  edit: 'write',
  patch: 'write',
  bash: 'shell',
  web_fetch: 'network',
  web_search: 'network',
  browser: 'browser',
  skill: 'skills',
  task: 'subagent',
};

export function toolPermissionGroup(name: string): PermissionGroup {
  if (name.startsWith('mcp_')) return 'external-services';
  return TOOL_PERMISSION_GROUPS[name] ?? 'write';
}
