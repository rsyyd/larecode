import type { Tool } from './tool.js';
import { DEFAULT_GLOB_LIMIT, globToRegExp, resolveInWorkspace, walkFiles } from './files.js';

interface GlobArgs {
  pattern: string;
  path?: string;
  limit?: number;
}

export function globTool(): Tool {
  return {
    name: 'glob',
    description:
      'Find workspace files matching a glob pattern (*, **, ?). Sorted, capped at the limit.',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern, e.g. src/**/*.ts' },
        path: {
          type: 'string',
          description: 'Subdirectory to search under (default workspace root)',
        },
        limit: { type: 'number', description: 'Maximum number of files to return' },
      },
      required: ['pattern'],
    },
    async execute(args, context) {
      const { pattern, path: sub, limit } = args as GlobArgs;
      const root =
        sub === undefined ? context.workingDir : resolveInWorkspace(context.workingDir, sub);
      const matcher = globToRegExp(pattern);
      const cap = limit ?? DEFAULT_GLOB_LIMIT;

      const files: string[] = [];
      for await (const file of walkFiles(root)) {
        if (!matcher.test(file)) continue;
        files.push(sub === undefined ? file : `${sub.replace(/\/+$/, '')}/${file}`);
        if (files.length > cap) break;
      }

      files.sort();
      const truncated = files.length > cap;
      return { files: files.slice(0, cap), count: Math.min(files.length, cap), truncated };
    },
  };
}
