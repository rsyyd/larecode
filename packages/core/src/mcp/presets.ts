import type { MCPServerConfig } from './mcp.js';

export const MCP_PRESETS: Record<string, Omit<MCPServerConfig, 'name'>> = {
  context7: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
  },
  playwright: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
  },
  serena: {
    transport: 'stdio',
    command: 'uvx',
    args: ['--from', 'git+https://github.com/oraios/serena', 'serena', 'start-mcp-server'],
  },
};

export const MCP_PRESET_NAMES = Object.keys(MCP_PRESETS);
