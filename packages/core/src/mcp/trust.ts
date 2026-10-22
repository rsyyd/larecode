import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { larecodeHome } from '../config/config.js';
import type { MCPServerConfig } from './mcp.js';

export interface McpTrustEntry {
  fingerprint: string;
  approvedAt: string;
}

export type McpTrustData = Record<string, McpTrustEntry>;

export function mcpTrustPath(): string {
  return process.env.LARECODE_MCP_TRUST ?? join(larecodeHome(), 'mcp-trust.json');
}

function pairs(value: Record<string, string> | undefined): Array<[string, string]> {
  return Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

export function mcpFingerprint(config: MCPServerConfig): string {
  const transport = config.transport ?? (config.url ? 'http' : 'stdio');
  const material = JSON.stringify({
    name: config.name,
    transport,
    command: config.command ?? '',
    args: config.args ?? [],
    url: config.url ?? '',
    allowPrivate: config.allowPrivate ?? false,
    env: pairs(config.env),
    headers: pairs(config.headers),
  });
  return createHash('sha256').update(material).digest('hex');
}

export class McpTrust {
  private readonly path: string;

  constructor(path: string = mcpTrustPath()) {
    this.path = path;
  }

  read(): McpTrustData {
    if (!existsSync(this.path)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as McpTrustData;
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  isTrusted(config: MCPServerConfig): boolean {
    return this.read()[config.name]?.fingerprint === mcpFingerprint(config);
  }

  trust(config: MCPServerConfig): void {
    const data = this.read();
    data[config.name] = {
      fingerprint: mcpFingerprint(config),
      approvedAt: new Date().toISOString(),
    };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }

  revoke(name: string): boolean {
    const data = this.read();
    if (!data[name]) return false;
    delete data[name];
    writeFileSync(this.path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    return true;
  }
}
