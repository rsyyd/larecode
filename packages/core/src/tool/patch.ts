import { readFile } from 'node:fs/promises';
import { LareError } from '../error/error.js';
import type { Tool } from './tool.js';
import { applyReplacement, resolveInWorkspace, sha256, writeFileAtomic } from './files.js';

interface PatchArgs {
  path: string;
  sha256: string;
  find: string;
  replace: string;
  replaceAll?: boolean;
}

export function patchTool(): Tool {
  return {
    name: 'patch',
    description:
      'Apply a text patch to a workspace file, rejected when the file content no longer matches the expected SHA-256.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace' },
        sha256: {
          type: 'string',
          description: 'SHA-256 of the file content the patch was generated against',
        },
        find: { type: 'string', description: 'Exact text to replace' },
        replace: { type: 'string', description: 'Replacement text' },
        replaceAll: { type: 'boolean', description: 'Replace every occurrence (default false)' },
      },
      required: ['path', 'sha256', 'find', 'replace'],
    },
    async execute(args, context) {
      const { path: input, sha256: expected, find, replace, replaceAll } = args as PatchArgs;
      const abs = resolveInWorkspace(context.workingDir, input);

      let buf: Buffer;
      try {
        buf = await readFile(abs);
      } catch {
        throw new LareError('TOOL_EXECUTION_FAILED', `file not found: ${input}`, {
          context: { path: input },
        });
      }

      const current = sha256(buf);
      if (current !== expected) {
        throw new LareError(
          'PATCH_CONFLICT',
          `patch rejected for ${input}: expected sha256 ${expected}, found ${current}`,
          { context: { path: input, expected, current } }
        );
      }

      const { updated, replacements } = applyReplacement(
        buf.toString('utf8'),
        find,
        replace,
        replaceAll ?? false,
        input
      );
      await writeFileAtomic(abs, updated);

      return { path: input, replacements, sha256: sha256(updated) };
    },
  };
}
