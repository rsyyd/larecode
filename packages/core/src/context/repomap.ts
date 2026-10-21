import { dirname, join } from 'node:path';
import { Lang, parse, type SgNode } from '@ast-grep/napi';
import { looksBinary, readFilesConcurrent, walkFiles } from '../tool/files.js';
import { estimateTokens } from '../usage/usage.js';

export interface RepoMapOptions {
  budgetTokens?: number;
  maxFiles?: number;
  maxSymbolsPerFile?: number;
}

export const REPO_MAP_BUDGET_TOKENS = 1000;
const MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_FILES = 400;
const DEFAULT_MAX_SYMBOLS_PER_FILE = 12;
const MAX_SYMBOL_CHARS = 600;

interface LanguageFacts {
  lang: Lang;
  symbolKinds: readonly string[];
  importKind: string;
}

const TS_SYMBOL_KINDS = [
  'function_declaration',
  'class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'method_definition',
] as const;

const JS_SYMBOL_KINDS = ['function_declaration', 'class_declaration', 'method_definition'] as const;

const LANGUAGES: Record<string, LanguageFacts> = {
  ts: { lang: Lang.TypeScript, symbolKinds: TS_SYMBOL_KINDS, importKind: 'import_statement' },
  tsx: { lang: Lang.Tsx, symbolKinds: TS_SYMBOL_KINDS, importKind: 'import_statement' },
  js: { lang: Lang.JavaScript, symbolKinds: JS_SYMBOL_KINDS, importKind: 'import_statement' },
  jsx: { lang: Lang.Tsx, symbolKinds: JS_SYMBOL_KINDS, importKind: 'import_statement' },
};

export function languageFacts(file: string): LanguageFacts | undefined {
  const dot = file.lastIndexOf('.');
  if (dot < 0) return undefined;
  return LANGUAGES[file.slice(dot + 1).toLowerCase()];
}

export interface SymbolFact {
  name: string;
  kind: string;
  line: number;
}

export interface FileFacts {
  file: string;
  symbols: SymbolFact[];
  imports: string[];
}

function nodeName(node: SgNode): string | undefined {
  return node.field('name')?.text() ?? undefined;
}

export function extractFileFacts(code: string, file: string): FileFacts {
  const facts = languageFacts(file);
  if (!facts) return { file, symbols: [], imports: [] };
  const root = parse(facts.lang, code).root();
  const symbols: SymbolFact[] = [];
  const seen = new Set<string>();
  for (const node of root.findAll({ rule: { kind: 'variable_declarator' } })) {
    const valueKind = node.field('value')?.kind();
    if (valueKind !== 'arrow_function' && valueKind !== 'function_expression') continue;
    const name = nodeName(node);
    if (!name || seen.has(`const:${name}`)) continue;
    seen.add(`const:${name}`);
    symbols.push({ name, kind: 'const', line: node.range().start.line + 1 });
  }
  for (const kind of facts.symbolKinds) {
    const label = kind.replace(/_declaration$|_definition$|_alias$/, '').replace(/_/g, ' ');
    for (const node of root.findAll({ rule: { kind } })) {
      const name = nodeName(node);
      if (!name || seen.has(`${kind}:${name}`)) continue;
      seen.add(`${kind}:${name}`);
      symbols.push({ name, kind: label, line: node.range().start.line + 1 });
    }
  }
  symbols.sort((a, b) => a.line - b.line);
  const imports: string[] = [];
  for (const node of root.findAll({ rule: { kind: facts.importKind } })) {
    const source = node.field('source')?.text();
    if (source && source.length > 1) imports.push(source.slice(1, -1));
  }
  return { file, symbols, imports };
}

export function resolveImport(
  fromFile: string,
  specifier: string,
  files: Set<string>
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = join(dirname(fromFile), specifier);
  const stripped = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/, '');
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((extension) => stripped + extension),
    `${stripped}/index.ts`,
    `${stripped}/index.tsx`,
    `${stripped}/index.js`,
  ];
  for (const candidate of candidates) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

export function pageRank(
  files: string[],
  edges: Map<string, Set<string>>,
  options: { damping?: number; iterations?: number } = {}
): Map<string, number> {
  const damping = options.damping ?? 0.85;
  const iterations = options.iterations ?? 20;
  const incoming = new Map<string, string[]>();
  for (const [from, targets] of edges) {
    for (const target of targets) {
      const list = incoming.get(target) ?? [];
      list.push(from);
      incoming.set(target, list);
    }
  }
  let scores = new Map(files.map((file) => [file, 1 / files.length]));
  for (let i = 0; i < iterations; i += 1) {
    const next = new Map<string, number>();
    for (const file of files) {
      let flow = 0;
      for (const source of incoming.get(file) ?? []) {
        const outDegree = edges.get(source)?.size ?? 0;
        if (outDegree > 0) flow += (scores.get(source) ?? 0) / outDegree;
      }
      next.set(file, (1 - damping) / files.length + damping * flow);
    }
    scores = next;
  }
  return scores;
}

export async function buildRepoMap(root: string, options: RepoMapOptions = {}): Promise<string> {
  const budget = options.budgetTokens ?? REPO_MAP_BUDGET_TOKENS;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxSymbolsPerFile = options.maxSymbolsPerFile ?? DEFAULT_MAX_SYMBOLS_PER_FILE;

  const facts: FileFacts[] = [];
  const fileSet = new Set<string>();
  const candidates: string[] = [];
  for await (const file of walkFiles(root)) {
    if (candidates.length >= maxFiles) break;
    if (languageFacts(file)) candidates.push(file);
  }
  const loaded = await readFilesConcurrent(root, candidates, { maxBytes: MAX_FILE_BYTES });
  for (const { file, buf } of loaded) {
    if (looksBinary(buf)) continue;
    fileSet.add(file);
    try {
      facts.push(extractFileFacts(buf.toString('utf8'), file));
    } catch {
      facts.push({ file, symbols: [], imports: [] });
    }
  }

  const edges = new Map<string, Set<string>>();
  for (const fact of facts) {
    const targets = new Set<string>();
    for (const specifier of fact.imports) {
      const resolved = resolveImport(fact.file, specifier, fileSet);
      if (resolved && resolved !== fact.file) targets.add(resolved);
    }
    edges.set(fact.file, targets);
  }
  const withSymbols = facts.filter((fact) => fact.symbols.length > 0);
  const ranks = pageRank(
    facts.map((fact) => fact.file),
    edges
  );
  const ordered = [...withSymbols].sort(
    (a, b) => (ranks.get(b.file) ?? 0) - (ranks.get(a.file) ?? 0)
  );

  const lines: string[] = [];
  let used = 0;
  for (const fact of ordered) {
    const rendered = fact.symbols
      .slice(0, maxSymbolsPerFile)
      .map((symbol) => `${symbol.name} (${symbol.kind})`)
      .join(', ');
    const trimmed =
      rendered.length > MAX_SYMBOL_CHARS ? `${rendered.slice(0, MAX_SYMBOL_CHARS)}…` : rendered;
    const more =
      fact.symbols.length > maxSymbolsPerFile
        ? ` (+${fact.symbols.length - maxSymbolsPerFile} more)`
        : '';
    const line = `${fact.file}: ${trimmed}${more}`;
    const cost = estimateTokens(line) + 1;
    if (lines.length > 0 && used + cost > budget) break;
    lines.push(line);
    used += cost;
  }
  const remaining = ordered.length - lines.length;
  if (remaining > 0) lines.push(`(+${remaining} more files)`);
  return lines.join('\n');
}
