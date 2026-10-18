import { LumpsError } from '../error/error.js';
import type { Tool } from '../tool/tool.js';

export type AgentName = 'build' | 'plan' | 'general';

export interface AgentDefinition {
  name: AgentName;
  description: string;
  kind: 'primary' | 'subagent';
  tools: string[];
  systemPrompt: string;
  askBeforeBash?: boolean;
}

export const BUILTIN_AGENTS: Record<AgentName, AgentDefinition> = {
  build: {
    name: 'build',
    description: 'Full access: edits files and runs commands.',
    kind: 'primary',
    tools: ['*'],
    systemPrompt:
      'You are the build agent. Complete the task end to end, editing files and running commands as needed.',
  },
  plan: {
    name: 'plan',
    description: 'Read-only: investigates and proposes a plan, asks before commands.',
    kind: 'primary',
    tools: [
      'read',
      'glob',
      'grep',
      'ast_grep',
      'lsp',
      'bash',
      'task',
      'web_fetch',
      'web_search',
      'session_search',
    ],
    askBeforeBash: true,
    systemPrompt:
      'You are the plan agent. Investigate the codebase read-only, then propose a plan. You cannot edit files; commands require confirmation.',
  },
  general: {
    name: 'general',
    description: 'Read-only research subagent (@general).',
    kind: 'subagent',
    tools: ['read', 'glob', 'grep', 'ast_grep', 'lsp', 'web_fetch', 'web_search', 'session_search'],
    systemPrompt:
      'You are a research subagent. Answer the question from the codebase without edits and keep the answer short and factual.',
  },
};

function gateBash(tool: Tool): Tool {
  return {
    ...tool,
    async execute(args, context) {
      const decision = context.permissions.check('shell', { source: 'plan:bash' });
      if (!decision.allowed) {
        throw new LumpsError(
          'PERMISSION_DENIED',
          decision.reason ?? 'plan mode asks before running commands'
        );
      }
      return tool.execute(args, context);
    },
  };
}

export function toolsForAgent(all: Tool[], agent: AgentDefinition): Tool[] {
  const allowed = agent.tools.includes('*')
    ? all
    : all.filter((tool) => agent.tools.includes(tool.name));
  if (!agent.askBeforeBash) return [...allowed];
  return allowed.map((tool) => (tool.name === 'bash' ? gateBash(tool) : tool));
}
