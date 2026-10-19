import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LareError } from '../error/error.js';
import type { Tool } from './tool.js';
import {
  DEFAULT_GREP_LIMIT,
  globToRegExp,
  looksBinary,
  resolveInWorkspace,
  walkFiles,
} from './files.js';

interface GrepArgs {
  pattern: string;
  path?: string;
  include?: string;
  ignoreCase?: boolean;
  maxResults?: number;
}

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

const MAX_LINE_CHARS = 500;

export function grepTool(): Tool {
  return {
    name: 'grep',
    description:
      'Search workspace file contents with a regular expression, returning file, line, and text.',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for' },
        path: {
          type: 'string',
          description: 'Subdirectory to search under (default workspace root)',
        },
        include: { type: 'string', description: 'Glob filter on file paths, e.g. **/*.ts' },
        ignoreCase: { type: 'boolean', description: 'Case-insensitive match' },
        maxResults: { type: 'number', description: 'Maximum number of matches to return' },
      },
      required: ['pattern'],
    },
    async execute(args, context) {
      const { pattern, path: sub, include, ignoreCase, maxResults } = args as GrepArgs;

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, ignoreCase ? 'i' : '');
      } catch (error) {
        throw new LareError(
          'TOOL_EXECUTION_FAILED',
          `invalid pattern: ${(error as Error).message}`
        );
      }

      const root =
        sub === undefined ? context.workingDir : resolveInWorkspace(context.workingDir, sub);
      const includeMatcher = include === undefined ? undefined : globToRegExp(include);
      const cap = maxResults ?? DEFAULT_GREP_LIMIT;

      const matches: GrepMatch[] = [];
      let truncated = false;

      search: for await (const file of walkFiles(root)) {
        if (includeMatcher && !includeMatcher.test(file)) continue;
        if (matches.length >= cap) {
          truncated = true;
          break;
        }

        let buf: Buffer;
        try {
          buf = await readFile(join(root, file));
        } catch {
          continue;
        }
        if (looksBinary(buf)) continue;

        const lines = buf.toString('utf8').split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (!regex.test(line)) continue;
          matches.push({
            file: sub === undefined ? file : `${sub.replace(/\/+$/, '')}/${file}`,
            line: i + 1,
            text: line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line,
          });
          if (matches.length >= cap) {
            truncated = true;
            break search;
          }
        }
      }

      return { matches, count: matches.length, truncated };
    },
  };
}
