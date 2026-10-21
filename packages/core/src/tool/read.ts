import { readFile } from 'node:fs/promises';
import { LareError } from '../error/error.js';
import type { Tool } from './tool.js';
import { MAX_READ_BYTES, looksBinary, resolveInWorkspace, sha256 } from './files.js';

interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export function readTool(): Tool {
  return {
    name: 'read',
    description: 'Read a text file from the workspace, optionally a 1-based line range.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace' },
        offset: { type: 'number', description: '1-based line to start from' },
        limit: { type: 'number', description: 'Maximum number of lines to return' },
      },
      required: ['path'],
    },
    async execute(args, context) {
      const { path: input, offset, limit } = args as ReadArgs;
      const abs = resolveInWorkspace(context.workingDir, input);

      let buf: Buffer;
      try {
        buf = await readFile(abs);
      } catch {
        throw new LareError('TOOL_EXECUTION_FAILED', `file not found: ${input}`, {
          context: { path: input, workingDir: context.workingDir },
        });
      }

      if (looksBinary(buf)) {
        throw new LareError(
          'TOOL_EXECUTION_FAILED',
          `binary file cannot be read as text: ${input}`,
          {
            context: { path: input },
          }
        );
      }

      const fullText = buf.toString('utf8');
      const lines = fullText.split('\n');
      const totalLines = lines.length - (fullText.endsWith('\n') ? 1 : 0);

      const start = Math.max(0, (offset ?? 1) - 1);
      const end = limit !== undefined ? Math.min(start + limit, lines.length) : lines.length;
      let content = lines.slice(start, end).join('\n');

      let truncated = end < totalLines;
      if (limit === undefined && Buffer.byteLength(content) > MAX_READ_BYTES) {
        content = content.slice(0, MAX_READ_BYTES);
        truncated = true;
      }

      return {
        path: input,
        content,
        offset: start + 1,
        totalLines,
        truncated,
        sha256: sha256(buf),
      };
    },
  };
}
