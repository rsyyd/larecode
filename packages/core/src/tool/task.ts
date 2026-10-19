import { LareError } from '../error/error.js';
import type { Tool } from '../tool/tool.js';
import type { AgentName } from '../agent/agents.js';
import type { Subagents } from '../agent/subagent.js';

export interface TaskToolOptions {
  provider: string;
  model: string;
  compressTo?: number;
}

export function taskTool(subagents: Subagents, options: TaskToolOptions): Tool {
  return {
    name: 'task',
    description:
      'Delegate read-only research to a subagent and get a compressed result. Useful for self-contained investigation.',
    schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Research question or task for the subagent' },
        agent: { type: 'string', description: 'Subagent to run (default "general")' },
      },
      required: ['prompt'],
    },
    async execute(args, context) {
      const input = (args ?? {}) as { prompt?: string; agent?: string };
      if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
        throw new LareError('TOOL_EXECUTION_FAILED', 'task requires a prompt');
      }
      const agent = (input.agent ?? 'general') as AgentName;
      const decision = context.permissions.check('subagent', { source: `task:${agent}` });
      if (!decision.allowed) {
        throw new LareError(
          'PERMISSION_DENIED',
          decision.reason ?? `subagent "${agent}" requires approval`,
          { context: { agent } }
        );
      }
      // depth stays 0 here; nested runs cannot happen through tools because
      // subagent definitions exclude the task tool, the runner still guards.
      const result = await subagents.run({
        prompt: input.prompt,
        agent,
        provider: options.provider,
        model: options.model,
        compressTo: options.compressTo,
        signal: context.abortSignal,
      });
      return {
        agent: result.agent,
        text: result.text,
        tokens: result.tokens,
        haltReason: result.haltReason,
      };
    },
  };
}
