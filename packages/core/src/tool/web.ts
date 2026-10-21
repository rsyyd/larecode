import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { LareError } from '../error/error.js';
import type { Tool, ToolContext } from './tool.js';

export const WEB_FETCH_TIMEOUT_MS = 15_000;
export const WEB_FETCH_MAX_CHARS = 50_000;
export const WEB_SEARCH_LIMIT = 5;
export const WEB_SEARCH_MAX_LIMIT = 10;
export const WEB_FETCH_MAX_REDIRECTS = 3;

const USER_AGENT = 'Mozilla/5.0 (compatible; LareCode/0.0.0; +https://github.com/rsyyd/larecode)';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => codepoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => codepoint(Number(code)))
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/gi, (match, name: string) => {
      return ENTITIES[name.toLowerCase()] ?? match;
    });
}

function codepoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch
    ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
    : '';
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(
        /<(?:br\s*\/?|\/(?:p|div|li|tr|h[1-6]|section|article|pre|blockquote|ul|ol|table))\s*>/gi,
        '\n'
      )
      .replace(/<[^>]+>/g, ' ')
  )
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

export function parseHttpUrl(input: unknown): URL {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new LareError('TOOL_EXECUTION_FAILED', 'url is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new LareError('TOOL_EXECUTION_FAILED', `invalid url: ${input}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new LareError(
      'TOOL_EXECUTION_FAILED',
      `unsupported protocol: ${parsed.protocol.replace(':', '')} (only http and https)`
    );
  }
  return parsed;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

export function isPrivateAddress(address: string): boolean {
  const value = address
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split('%')[0];
  const family = isIP(value);
  if (family === 4) {
    const parts = value.split('.').map((part) => Number(part));
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return true;
    }
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    if (value === '::' || value === '::1') return true;
    if (
      value.startsWith('fe8') ||
      value.startsWith('fe9') ||
      value.startsWith('fea') ||
      value.startsWith('feb')
    ) {
      return true;
    }
    if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('ff')) return true;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

export async function assertPublicHttpUrl(input: string | URL): Promise<URL> {
  const parsed = input instanceof URL ? input : parseHttpUrl(input);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new LareError('TOOL_EXECUTION_FAILED', `blocked private network address: ${hostname}`);
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new LareError('TOOL_EXECUTION_FAILED', `blocked private network address: ${hostname}`);
    }
    return parsed;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new LareError(
      'NETWORK_ERROR',
      `dns lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error instanceof Error ? error : undefined, context: { hostname } }
    );
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new LareError('TOOL_EXECUTION_FAILED', `blocked private network address: ${hostname}`);
  }
  return parsed;
}

function requireNetwork(context: ToolContext, source: string): void {
  const decision = context.permissions.check('network', { source });
  if (!decision.allowed) {
    throw new LareError(
      'PERMISSION_DENIED',
      decision.reason ?? `${source.split(':')[0]} requires the network permission group`,
      { context: { source } }
    );
  }
}

function requestSignal(context: ToolContext): AbortSignal {
  const timeout = AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS);
  return context.abortSignal ? AbortSignal.any([context.abortSignal, timeout]) : timeout;
}

async function request(
  url: string,
  context: ToolContext,
  accept: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ body: string; url: string; contentType: string }> {
  let current = parseHttpUrl(url);
  for (let redirects = 0; redirects <= WEB_FETCH_MAX_REDIRECTS; redirects += 1) {
    await assertPublicHttpUrl(current);
    let response: Response;
    try {
      response = await fetch(current.href, {
        redirect: 'manual',
        signal: requestSignal(context),
        headers: { 'user-agent': USER_AGENT, accept, ...extraHeaders },
      });
    } catch (error) {
      throw new LareError(
        'NETWORK_ERROR',
        `request failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { url: current.href },
        }
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new LareError('NETWORK_ERROR', 'redirect without a location', {
          context: { url: current.href, status: response.status },
        });
      }
      current = parseHttpUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      throw new LareError('NETWORK_ERROR', `request failed: HTTP ${response.status}`, {
        context: { url: current.href, status: response.status },
      });
    }
    return {
      body: await response.text(),
      url: response.url || current.href,
      contentType: response.headers.get('content-type') ?? '',
    };
  }
  throw new LareError('NETWORK_ERROR', `too many redirects (max ${WEB_FETCH_MAX_REDIRECTS})`);
}

interface WebFetchArgs {
  url?: string;
  maxChars?: number;
}

export function webFetchTool(): Tool {
  return {
    name: 'web_fetch',
    description:
      'Fetch an http(s) URL and return its readable text with the page title. HTML is converted to plain text. Requires the network permission group.',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch' },
        maxChars: {
          type: 'number',
          description: `Maximum characters of text to return (default ${WEB_FETCH_MAX_CHARS})`,
        },
      },
      required: ['url'],
    },
    async execute(args, context) {
      const { url, maxChars } = (args ?? {}) as WebFetchArgs;
      const parsed = parseHttpUrl(url);
      requireNetwork(context, `web_fetch:${parsed.hostname}`);
      const requested =
        typeof maxChars === 'number' && maxChars > 0 ? maxChars : WEB_FETCH_MAX_CHARS;
      const limit = Math.min(requested, WEB_FETCH_MAX_CHARS);
      const response = await request(
        parsed.href,
        context,
        'text/html,application/json,text/plain;q=0.9,*/*;q=0.5'
      );
      const isHtml = response.contentType.includes('html');
      const { title, text } = isHtml
        ? htmlToText(response.body)
        : { title: '', text: response.body };
      const truncated = text.length > limit;
      return {
        url: response.url,
        contentType: response.contentType,
        title,
        content: truncated ? text.slice(0, limit) : text,
        truncated,
      };
    },
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function parseDuckDuckGo(html: string): SearchResult[] {
  const snippets: string[] = [];
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(snippetRe)) {
    snippets.push(decodeEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim());
  }
  const results: SearchResult[] = [];
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let index = 0;
  for (const match of html.matchAll(linkRe)) {
    const url = normalizeDuckDuckGoUrl(match[1]);
    const title = decodeEntities(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
    if (!url || title === '') {
      index += 1;
      continue;
    }
    results.push({ title, url, snippet: snippets[index] ?? '' });
    index += 1;
  }
  return results;
}

function normalizeDuckDuckGoUrl(href: string): string {
  const decoded = decodeEntities(href);
  if (decoded.startsWith('//duckduckgo.com/l/') || decoded.includes('/l/?uddg=')) {
    const query = decoded.slice(decoded.indexOf('?') + 1);
    for (const pair of query.split('&')) {
      const [key, value] = pair.split('=');
      if (key === 'uddg' && value) return decodeURIComponent(value);
    }
    return '';
  }
  return decoded.startsWith('http') ? decoded : '';
}

interface WebSearchArgs {
  query?: string;
  limit?: number;
}

export interface WebSearchOptions {
  provider?: 'duckduckgo' | 'custom';
  endpoint?: string;
  apiKey?: string;
}

function customSearchRequest(
  endpoint: string,
  query: string,
  limit: number,
  apiKey?: string
): { url: string; headers: Record<string, string> } {
  const parsed = parseHttpUrl(endpoint.replace('{query}', encodeURIComponent(query)));
  parsed.searchParams.set('q', query);
  parsed.searchParams.set('limit', String(limit));
  return {
    url: parsed.href,
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  };
}

function parseCustomResults(body: string): SearchResult[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new LareError('TOOL_EXECUTION_FAILED', 'search provider returned invalid JSON');
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results)
      ? (raw as { results: unknown[] }).results
      : [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.title !== 'string' || typeof record.url !== 'string') return [];
    return [
      {
        title: record.title,
        url: record.url,
        snippet: typeof record.snippet === 'string' ? record.snippet : '',
      },
    ];
  });
}

export function webSearchTool(options: WebSearchOptions = {}): Tool {
  const provider = options.provider ?? 'duckduckgo';
  return {
    name: 'web_search',
    description:
      provider === 'custom'
        ? 'Search the configured web search provider and return result titles, URLs, and snippets. Requires the network permission group.'
        : 'Search the web with DuckDuckGo and return result titles, URLs, and snippets. Requires the network permission group.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: {
          type: 'number',
          description: `Maximum results to return (default ${WEB_SEARCH_LIMIT}, max ${WEB_SEARCH_MAX_LIMIT})`,
        },
      },
      required: ['query'],
    },
    async execute(args, context) {
      const { query, limit } = (args ?? {}) as WebSearchArgs;
      if (typeof query !== 'string' || query.trim() === '') {
        throw new LareError('TOOL_EXECUTION_FAILED', 'query is required');
      }
      requireNetwork(context, `web_search:${query.slice(0, 60)}`);
      const requested =
        typeof limit === 'number' && limit > 0 ? Math.floor(limit) : WEB_SEARCH_LIMIT;
      const capped = Math.min(requested, WEB_SEARCH_MAX_LIMIT);
      if (provider === 'custom') {
        if (!options.endpoint) {
          throw new LareError('TOOL_EXECUTION_FAILED', 'web search endpoint is not configured');
        }
        const search = customSearchRequest(options.endpoint, query, capped, options.apiKey);
        const response = await request(search.url, context, 'application/json', search.headers);
        return { query, results: parseCustomResults(response.body).slice(0, capped) };
      }
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      // ponytail: scrapes the DuckDuckGo HTML endpoint (no API key); swap for a
      // search provider when one is configured.
      const response = await request(url, context, 'text/html');
      return { query, results: parseDuckDuckGo(response.body).slice(0, capped) };
    },
  };
}
