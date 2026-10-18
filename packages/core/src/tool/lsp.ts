import { LumpsError } from '../error/error.js';
import type { LSP, SymbolInfo } from '../lsp/lsp.js';
import type { Tool } from './tool.js';

interface LspArgs {
  action: string;
  path: string;
  line?: number;
  column?: number;
}

const POSITION_ACTIONS = new Set(['definition', 'references', 'hover']);

function format(info: SymbolInfo): string {
  const base = `${info.file}:${info.line}:${info.column}`;
  return info.name ? `${base} ${info.kind} ${info.name}` : base;
}

export function lspTool(lsp: LSP): Tool {
  return {
    name: 'lsp',
    description:
      'Query a language server: document symbols, go-to-definition, find references, or hover docs. Positions are 1-based line and column. Returns an empty result with a reason when no language server is available.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'One of: symbols, definition, references, hover' },
        path: { type: 'string', description: 'File path relative to the workspace' },
        line: {
          type: 'number',
          description: '1-based line, required for definition, references, and hover',
        },
        column: { type: 'number', description: '1-based column, defaults to 1' },
      },
      required: ['action', 'path'],
    },
    async execute(args) {
      const { action, path, line, column } = args as LspArgs;
      if (POSITION_ACTIONS.has(action) && line === undefined) {
        throw new LumpsError('TOOL_EXECUTION_FAILED', `action "${action}" requires a line`);
      }
      const position = { line: line ?? 1, column: column ?? 1 };

      let results: SymbolInfo[] = [];
      let hover: string | null = null;
      switch (action) {
        case 'symbols':
          results = await lsp.symbols(path);
          break;
        case 'definition':
          results = await lsp.definitions(path, position.line, position.column);
          break;
        case 'references':
          results = await lsp.references(path, position.line, position.column);
          break;
        case 'hover':
          hover = await lsp.hover(path, position.line, position.column);
          break;
        default:
          throw new LumpsError('TOOL_EXECUTION_FAILED', `unknown action: ${action}`);
      }

      if (!lsp.available()) {
        return {
          unavailable: true,
          reason: lsp.reason() ?? 'language server unavailable',
          results: [],
        };
      }
      if (action === 'hover') return { results: hover ? [hover] : [] };
      return { results: results.map(format) };
    },
  };
}
