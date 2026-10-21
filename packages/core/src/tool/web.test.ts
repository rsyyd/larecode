import { afterEach, describe, expect, it, vi } from 'vitest';
import { Permissions } from '../permission/permission.js';
import type { ToolContext } from './tool.js';
import {
  WEB_FETCH_MAX_CHARS,
  decodeEntities,
  htmlToText,
  isPrivateAddress,
  parseDuckDuckGo,
  parseHttpUrl,
  webFetchTool,
  webSearchTool,
} from './web.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

const ALLOW_NETWORK = { mode: 'allow' as const, allowedGroups: ['network' as const] };

function ctx(permissions: Permissions): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: process.cwd(),
    permissions,
    abortSignal: new AbortController().signal,
  };
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('htmlToText', () => {
  it('extracts the title and strips scripts, styles, and tags', () => {
    const html = `<html><head><title>My &amp; Page</title><style>body{}</style></head>
      <body><script>evil()</script><h1>Hello</h1><p>World</p><br><p>Again</p></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe('My & Page');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('body{}');
    expect(text).toContain('Hello');
    expect(text).toContain('World');
    expect(text).toContain('Again');
  });

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('a &lt; b &#62; c &#x27;d&#x27; &nbsp;e')).toBe("a < b > c 'd'  e");
  });
});

describe('parseHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(parseHttpUrl('https://example.com/x').hostname).toBe('example.com');
    expect(() => parseHttpUrl('file:///etc/passwd')).toThrow(/unsupported protocol/);
    expect(() => parseHttpUrl('ftp://example.com')).toThrow(/unsupported protocol/);
    expect(() => parseHttpUrl('not a url')).toThrow(/invalid url/);
    expect(() => parseHttpUrl(undefined)).toThrow(/url is required/);
  });
});

describe('SSRF guards', () => {
  it('classifies private and public addresses', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
  });

  it('blocks literal private targets before fetching', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(
      webFetchTool().execute(
        { url: 'http://169.254.169.254/latest/meta-data/' },
        ctx(new Permissions(ALLOW_NETWORK))
      )
    ).rejects.toThrow(/private network/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks a redirect into a private target', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
      );
    await expect(
      webFetchTool().execute(
        { url: 'https://example.com/redirect' },
        ctx(new Permissions(ALLOW_NETWORK))
      )
    ).rejects.toThrow(/private network/);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('web_fetch', () => {
  it('denies without the network permission group and never fetches', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(
      webFetchTool().execute({ url: 'https://example.com/' }, ctx(new Permissions()))
    ).rejects.toThrow(/network/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetches and converts html to text when allowed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      htmlResponse('<html><head><title>T</title></head><body><p>Hello world</p></body></html>')
    );
    const result = (await webFetchTool().execute(
      { url: 'https://example.com/page' },
      ctx(new Permissions(ALLOW_NETWORK))
    )) as { title: string; content: string; truncated: boolean; contentType: string };
    expect(result.title).toBe('T');
    expect(result.content).toContain('Hello world');
    expect(result.truncated).toBe(false);
    expect(result.contentType).toContain('html');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.objectContaining({
        headers: expect.objectContaining({ 'user-agent': expect.any(String) }),
      })
    );
  });

  it('truncates at maxChars and caps at the global limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      htmlResponse(`<p>${'x'.repeat(WEB_FETCH_MAX_CHARS + 500)}</p>`)
    );
    const tool = webFetchTool();
    const small = (await tool.execute(
      { url: 'https://example.com/', maxChars: 100 },
      ctx(new Permissions(ALLOW_NETWORK))
    )) as { content: string; truncated: boolean };
    expect(small.content).toHaveLength(100);
    expect(small.truncated).toBe(true);

    const capped = (await tool.execute(
      { url: 'https://example.com/', maxChars: 10_000_000 },
      ctx(new Permissions(ALLOW_NETWORK))
    )) as { content: string; truncated: boolean };
    expect(capped.content).toHaveLength(WEB_FETCH_MAX_CHARS);
    expect(capped.truncated).toBe(true);
  });

  it('rejects non-http protocols before the permission check', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(
      webFetchTool().execute({ url: 'file:///etc/passwd' }, ctx(new Permissions(ALLOW_NETWORK)))
    ).rejects.toThrow(/unsupported protocol/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces http failures as NETWORK_ERROR', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(
      webFetchTool().execute(
        { url: 'https://example.com/missing' },
        ctx(new Permissions(ALLOW_NETWORK))
      )
    ).rejects.toThrow(/HTTP 404/);
  });
});

const DDG_HTML = `<div class="results">
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fa%3D1&amp;rut=x">Example &amp; Co</a>
    <a class="result__snippet" href="https://example.com/page">Snippet <b>one</b> here</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://docs.example.org/">Docs</a>
    <a class="result__snippet" href="https://docs.example.org/">Second snippet</a>
  </div>
</div>`;

describe('parseDuckDuckGo', () => {
  it('extracts results and decodes uddg redirects', () => {
    expect(parseDuckDuckGo(DDG_HTML)).toEqual([
      { title: 'Example & Co', url: 'https://example.com/page?a=1', snippet: 'Snippet one here' },
      { title: 'Docs', url: 'https://docs.example.org/', snippet: 'Second snippet' },
    ]);
  });
});

describe('web_search', () => {
  it('denies without the network permission group', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(
      webSearchTool().execute({ query: 'lare' }, ctx(new Permissions()))
    ).rejects.toThrow(/network/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('searches and caps results at the requested limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(DDG_HTML));
    const result = (await webSearchTool().execute(
      { query: 'lare code', limit: 1 },
      ctx(new Permissions(ALLOW_NETWORK))
    )) as { query: string; results: unknown[] };
    expect(result.query).toBe('lare code');
    expect(result.results).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://html.duckduckgo.com/html/?q=lare%20code',
      expect.anything()
    );
  });

  it('requires a non-empty query', async () => {
    await expect(
      webSearchTool().execute({ query: '  ' }, ctx(new Permissions(ALLOW_NETWORK)))
    ).rejects.toThrow(/query is required/);
  });

  it('uses a configured custom search provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { title: 'One', url: 'https://one.example/', snippet: 'first' },
            { title: 'Two', url: 'https://two.example/', snippet: 'second' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const tool = webSearchTool({
      provider: 'custom',
      endpoint: 'https://search.example/api',
      apiKey: 'secret',
    });
    const result = (await tool.execute(
      { query: 'lare code', limit: 1 },
      ctx(new Permissions(ALLOW_NETWORK))
    )) as { results: unknown[] };
    expect(result.results).toEqual([
      { title: 'One', url: 'https://one.example/', snippet: 'first' },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://search.example/api?q=lare+code&limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      })
    );
  });
});
