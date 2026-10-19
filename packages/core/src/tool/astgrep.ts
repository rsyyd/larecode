import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Lang, parse, type SgNode } from '@ast-grep/napi';
import { LareError } from '../error/error.js';
import type { Tool } from './tool.js';
import { looksBinary, resolveInWorkspace, walkFiles } from './files.js';

interface AstGrepArgs {
  pattern: string;
  path?: string;
  lang?: string;
  maxResults?: number;
}

const LANGS: Record<string, Lang> = {
  ts: Lang.TypeScript,
  typescript: Lang.TypeScript,
  tsx: Lang.Tsx,
  js: Lang.JavaScript,
  javascript: Lang.JavaScript,
  jsx: Lang.Tsx,
};

const EXT_LANGS: Record<string, Lang> = {
  '.ts': Lang.TypeScript,
  '.tsx': Lang.Tsx,
  '.js': Lang.JavaScript,
  '.mjs': Lang.JavaScript,
  '.cjs': Lang.JavaScript,
  '.jsx': Lang.Tsx,
};

export const AST_GREP_LIMIT = 50;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_MATCH_CHARS = 200;

function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot < 0 ? '' : file.slice(dot).toLowerCase();
}

function hasErrorNode(node: SgNode): boolean {
  if (node.kind() === 'ERROR') return true;
  for (const child of node.children()) {
    if (hasErrorNode(child)) return true;
  }
  return false;
}

export function astGrepTool(): Tool {
  return {
    name: 'ast_grep',
    description:
      'Structural code search with ast-grep patterns, e.g. "function $NAME($$$ARGS) { $$$BODY }" or "console.log($ARG)". Returns file, line, and matched text.',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'ast-grep pattern to search for' },
        path: {
          type: 'string',
          description: 'Subdirectory to search under (default workspace root)',
        },
        lang: {
          type: 'string',
          description: 'Restrict to a language: ts, tsx, js, or jsx (default all)',
        },
        maxResults: { type: 'number', description: 'Maximum number of matches to return' },
      },
      required: ['pattern'],
    },
    async execute(args, context) {
      const { pattern, path: sub, lang, maxResults } = (args ?? {}) as AstGrepArgs;
      if (typeof pattern !== 'string' || pattern.trim() === '') {
        throw new LareError('TOOL_EXECUTION_FAILED', 'ast_grep requires a pattern');
      }
      let forcedLang: Lang | undefined;
      if (lang !== undefined) {
        forcedLang = LANGS[lang.toLowerCase()];
        if (!forcedLang) {
          throw new LareError(
            'TOOL_EXECUTION_FAILED',
            `unsupported lang "${lang}"; use ts, tsx, js, or jsx`
          );
        }
      }
      try {
        const probe = parse(forcedLang ?? Lang.TypeScript, pattern).root();
        if (hasErrorNode(probe)) {
          throw new Error('pattern does not parse as valid code');
        }
      } catch (error) {
        throw new LareError(
          'TOOL_EXECUTION_FAILED',
          `invalid pattern: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const root =
        sub === undefined ? context.workingDir : resolveInWorkspace(context.workingDir, sub);
      const cap = maxResults ?? AST_GREP_LIMIT;
      const matches: Array<{ file: string; line: number; text: string }> = [];
      let truncated = false;

      search: for await (const file of walkFiles(root)) {
        if (matches.length >= cap) break;
        const fileLang = EXT_LANGS[extensionOf(file)];
        if (!fileLang) continue;
        if (forcedLang && fileLang !== forcedLang) continue;
        let buf: Buffer;
        try {
          buf = await readFile(join(root, file));
        } catch {
          continue;
        }
        if (looksBinary(buf) || buf.length > MAX_FILE_BYTES) continue;
        const ast = parse(fileLang, buf.toString('utf8')).root();
        for (const node of ast.findAll({ rule: { pattern } })) {
          const first = node.text().split('\n')[0].trim();
          matches.push({
            file: sub === undefined ? file : `${sub.replace(/\/+$/, '')}/${file}`,
            line: node.range().start.line + 1,
            text: first.length > MAX_MATCH_CHARS ? `${first.slice(0, MAX_MATCH_CHARS)}…` : first,
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
