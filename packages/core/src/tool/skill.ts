import { LareError } from '../error/error.js';
import type { Tool } from '../tool/tool.js';
import type { Skills } from '../skill/skill.js';

export function skillTool(skills: Skills): Tool {
  return {
    name: 'skill',
    description:
      'List available skills or load one to follow its instructions. Loaded skills are prompt guidance for the current task.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Operation to perform: "list" or "load"' },
        name: { type: 'string', description: 'Skill name to load' },
      },
      required: ['action'],
    },
    async execute(args, context) {
      const input = (args ?? {}) as { action?: string; name?: string };
      skills.refresh();
      if (input.action === 'list') {
        return { skills: skills.list() };
      }
      if (input.action !== 'load') {
        throw new LareError('TOOL_EXECUTION_FAILED', 'skill requires action "list" or "load"');
      }
      if (typeof input.name !== 'string' || input.name.trim() === '') {
        throw new LareError('TOOL_EXECUTION_FAILED', 'skill load requires a name');
      }
      const name = input.name.trim();
      const decision = context.permissions.check('skills', { source: `skill:${name}` });
      if (!decision.allowed) {
        throw new LareError(
          'PERMISSION_DENIED',
          decision.reason ?? `loading skill "${name}" requires approval`,
          { context: { skill: name } }
        );
      }
      return { name, instructions: skills.load(name) };
    },
  };
}
