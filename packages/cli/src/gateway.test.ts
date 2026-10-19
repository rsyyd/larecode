import { describe, expect, it } from 'vitest';
import type { TelegramGatewayOptions } from '@lumpscode/gateway';
import { gatewayCommand, type GatewayDeps } from './commands/gateway.js';

function harness(overrides: Partial<GatewayDeps> = {}) {
  const out: string[] = [];
  const created: TelegramGatewayOptions[] = [];
  let ran = false;
  const deps: GatewayDeps = {
    env: {},
    write: (text) => out.push(text),
    create: (options) => {
      created.push(options);
      return {
        run: async (signal) => {
          ran = true;
          expect(signal.aborted).toBe(false);
        },
      };
    },
    ...overrides,
  };
  return { deps, out: () => out.join(''), created, ran: () => ran };
}

describe('gateway command', () => {
  it('requires a token', async () => {
    const ui = harness();
    expect(await gatewayCommand({}, ui.deps)).toBe(1);
    expect(ui.out()).toContain('bot token required');
  });

  it('reads the token and chat from the environment', async () => {
    const ui = harness({
      env: { LUMPSCODE_TELEGRAM_TOKEN: 'env-token', LUMPSCODE_TELEGRAM_CHAT_ID: '42' },
    });
    expect(await gatewayCommand({ platform: 'telegram' }, ui.deps)).toBe(0);
    expect(ui.created[0].token).toBe('env-token');
    expect(ui.created[0].allowedChatId).toBe('42');
    expect(ui.ran()).toBe(true);
    expect(ui.out()).toContain('gateway: telegram listening');
  });

  it('rejects unsupported platforms and bad policies', async () => {
    const platform = harness();
    expect(await gatewayCommand({ platform: 'signal', token: 't' }, platform.deps)).toBe(1);
    expect(platform.out()).toContain('unknown platform');

    const denied = harness();
    expect(await gatewayCommand({ token: 't', allow: 'read,secrets' }, denied.deps)).toBe(1);
    expect(denied.out()).toContain('never pre-authorizable');
    expect(denied.created).toHaveLength(0);

    const unknown = harness();
    expect(await gatewayCommand({ token: 't', allow: 'wat' }, unknown.deps)).toBe(1);
    expect(unknown.out()).toContain('unknown permission group');
  });

  it('passes the pre-authorized policy through', async () => {
    const ui = harness();
    expect(await gatewayCommand({ token: 't', chat: '7', allow: 'read,shell' }, ui.deps)).toBe(0);
    expect(ui.created[0].policy).toEqual(['read', 'shell']);
  });

  it('honours a custom api base for self-hosted bot servers', async () => {
    const ui = harness({ env: { LUMPSCODE_TELEGRAM_API_BASE: 'http://127.0.0.1:9999' } });
    expect(await gatewayCommand({ token: 't' }, ui.deps)).toBe(0);
    expect(ui.created[0].apiBase).toBe('http://127.0.0.1:9999');
  });

  it('reports runtime failures', async () => {
    const ui = harness({
      create: () => ({
        run: async () => {
          throw new Error('getMe rejected');
        },
      }),
    });
    expect(await gatewayCommand({ token: 't' }, ui.deps)).toBe(1);
    expect(ui.out()).toContain('getMe rejected');
  });
});
