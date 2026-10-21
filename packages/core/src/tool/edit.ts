import { readFile } from 'node:fs/promises';
import { LareError } from '../error/error.js';
import type { Tool } from './tool.js';
import { applyReplacement, resolveInWorkspace, sha256, writeFileAtomic } from './files.js';

interface EditArgs {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export function editTool(): Tool {
  return {
    name: 'edit',
    description:
      'Replace an exact text fragment in a workspace file. Fails when the fragment is missing or ambiguous.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace' },
        oldString: { type: 'string', description: 'Exact text to replace' },
        newString: { type: 'string', description: 'Replacement text' },
        replaceAll: { type: 'boolean', description: 'Replace every occurrence (default false)' },
      },
      required: ['path', 'oldString', 'newString'],
    },
    async execute(args, context) {
      const { path: input, oldString, newString, replaceAll } = args as EditArgs;
      const abs = resolveInWorkspace(context.workingDir, input);

      let content: string;
      try {
        content = await readFile(abs, 'utf8');
      } catch {
        throw new LareError('TOOL_EXECUTION_FAILED', `file not found: ${input}`, {
          context: { path: input },
        });
      }

      const { updated, replacements } = applyReplacement(
        content,
        oldString,
        newString,
        replaceAll ?? false,
        input
      );
      await writeFileAtomic(abs, updated);

      return { path: input, replacements, sha256: sha256(updated) };
    },
  };
}
