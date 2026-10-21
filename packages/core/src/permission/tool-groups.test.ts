import { describe, expect, it } from 'vitest';
import { TOOL_PERMISSION_GROUPS, toolPermissionGroup } from './tool-groups.js';

describe('tool permission groups', () => {
  it('maps every builtin tool to an explicit group', () => {
    expect(TOOL_PERMISSION_GROUPS).toMatchObject({
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
    });
  });

  it('routes MCP tools through external-services and unknown tools conservatively', () => {
    expect(toolPermissionGroup('mcp_fake_echo')).toBe('external-services');
    expect(toolPermissionGroup('not-a-real-tool')).toBe('write');
  });
});
