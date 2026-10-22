import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpTrust, mcpFingerprint } from './trust.js';
import type { MCPServerConfig } from './mcp.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lare-mcp-trust-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const server: MCPServerConfig = {
  name: 'remote',
  transport: 'http',
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer a', 'X-Trace': 'b' },
};

describe('mcp trust', () => {
  it('fingerprints the full transport config independent of header order', () => {
    const reordered = { ...server, headers: { 'X-Trace': 'b', Authorization: 'Bearer a' } };
    expect(mcpFingerprint(server)).toBe(mcpFingerprint(reordered));
    expect(mcpFingerprint({ ...server, url: 'https://evil.example/mcp' })).not.toBe(
      mcpFingerprint(server)
    );
    expect(mcpFingerprint({ ...server, headers: { Authorization: 'Bearer b' } })).not.toBe(
      mcpFingerprint(server)
    );
  });

  it('trusts, reports drift, and revokes without storing secrets', () => {
    const trust = new McpTrust(join(dir, 'trust.json'));
    expect(trust.isTrusted(server)).toBe(false);
    trust.trust(server);
    expect(trust.isTrusted(server)).toBe(true);
    expect(trust.read().remote?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(trust.read())).not.toContain('Bearer a');

    expect(trust.isTrusted({ ...server, command: 'node' })).toBe(false);
    expect(trust.revoke('remote')).toBe(true);
    expect(trust.isTrusted(server)).toBe(false);
    expect(trust.revoke('remote')).toBe(false);
  });
});
