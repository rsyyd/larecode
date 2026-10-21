import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from './tool.js';
import { resolveInWorkspace, sha256, writeFileAtomic } from './files.js';

interface WriteArgs {
  path: string;
  content: string;
}

export function writeTool(): Tool {
  return {
    name: 'write',
    description: 'Write a text file in the workspace, creating parent directories as needed.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace' },
        content: { type: 'string', description: 'Full file content' },
      },
      required: ['path', 'content'],
    },
    async execute(args, context) {
      const { path: input, content } = args as WriteArgs;
      const abs = resolveInWorkspace(context.workingDir, input);
      const created = !existsSync(abs);

      await mkdir(dirname(abs), { recursive: true });
      await writeFileAtomic(abs, content);

      return {
        path: input,
        bytes: Buffer.byteLength(content),
        created,
        sha256: sha256(content),
      };
    },
  };
}
