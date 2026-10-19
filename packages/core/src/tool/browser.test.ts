import { afterEach, describe, expect, it, vi } from 'vitest';
import { Permissions } from '../permission/permission.js';
import type { ToolContext } from './tool.js';
import { BROWSER_ACTIONS, browserTool, cdpEndpoint } from './browser.js';

const ALLOW_BROWSER = { mode: 'allow' as const, allowedGroups: ['browser' as const] };

function ctx(permissions: Permissions): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: process.cwd(),
    permissions,
    abortSignal: new AbortController().signal,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cdpEndpoint', () => {
  it('defaults to the local chrome port and honors LARECODE_CDP_URL', () => {
    expect(cdpEndpoint()).toBe('http://127.0.0.1:9222');
    vi.stubEnv('LARECODE_CDP_URL', 'http://127.0.0.1:9333');
    expect(cdpEndpoint()).toBe('http://127.0.0.1:9333');
  });
});

describe('browser tool', () => {
  it('rejects unknown actions', async () => {
    await expect(
      browserTool().execute({ action: 'launch' }, ctx(new Permissions(ALLOW_BROWSER)))
    ).rejects.toThrow(new RegExp(BROWSER_ACTIONS.join(', ')));
  });

  it('rejects non-http navigation before the permission check', async () => {
    await expect(
      browserTool().execute(
        { action: 'navigate', url: 'file:///etc/passwd' },
        ctx(new Permissions())
      )
    ).rejects.toThrow(/unsupported protocol/);
  });

  it('denies control without the browser permission group', async () => {
    await expect(
      browserTool().execute({ action: 'snapshot' }, ctx(new Permissions()))
    ).rejects.toThrow(/browser/);
  });

  it('requires a selector for click and type', async () => {
    const tool = browserTool();
    await expect(
      tool.execute({ action: 'click', selector: ' ' }, ctx(new Permissions(ALLOW_BROWSER)))
    ).rejects.toThrow(/requires a selector/);
    await expect(
      tool.execute({ action: 'type', selector: 'input' }, ctx(new Permissions(ALLOW_BROWSER)))
    ).rejects.toThrow(/requires text/);
  });

  it('reports an unreachable browser as NETWORK_ERROR', async () => {
    await expect(
      browserTool({ endpoint: 'http://127.0.0.1:1' }).execute(
        { action: 'snapshot' },
        ctx(new Permissions(ALLOW_BROWSER))
      )
    ).rejects.toThrow(/browser not reachable at http:\/\/127\.0\.0\.1:1/);
  });
});
