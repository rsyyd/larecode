import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog, hashChainAuditSink, readAuditLog, verifyAuditLog } from './audit.js';

describe('hash-chained audit log', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'larecode-audit-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes ordered entries that verify', () => {
    const path = join(dir, 'audit.log');
    const log = new AuditLog([hashChainAuditSink(path)]);
    log.record({
      group: 'read',
      allowed: true,
      requiresConfirmation: false,
      unattended: false,
      confirmedByUser: true,
      source: 'tool:read',
    });
    log.record({
      group: 'shell',
      allowed: false,
      requiresConfirmation: true,
      unattended: false,
      confirmedByUser: false,
      source: 'tool:bash',
    });

    expect(verifyAuditLog(path)).toEqual({ ok: true, entries: 2 });
    const entries = readAuditLog(path);
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(entries[1].prev).toBe(entries[0].hash);
  });

  it('detects tampering and removal', () => {
    const path = join(dir, 'audit.log');
    const log = new AuditLog([hashChainAuditSink(path)]);
    for (const source of ['a', 'b', 'c']) {
      log.record({
        group: 'read',
        allowed: true,
        requiresConfirmation: false,
        unattended: false,
        confirmedByUser: true,
        source,
      });
    }
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const tampered = JSON.parse(lines[0]) as { allowed: boolean };
    tampered.allowed = false;
    writeFileSync(path, `${JSON.stringify(tampered)}\n${lines.slice(1).join('\n')}\n`);
    expect(verifyAuditLog(path)).toMatchObject({
      ok: false,
      brokenAt: 1,
      reason: 'entry tampered',
    });

    writeFileSync(path, `${lines[0]}\n${lines[2]}\n`);
    expect(verifyAuditLog(path)).toMatchObject({ ok: false, reason: 'hash chain broken' });
  });

  it('continues the chain after reopening', () => {
    const path = join(dir, 'audit.log');
    const entry = {
      group: 'read' as const,
      allowed: true,
      requiresConfirmation: false,
      unattended: false,
      confirmedByUser: true,
    };
    new AuditLog([hashChainAuditSink(path)]).record(entry);
    new AuditLog([hashChainAuditSink(path)]).record(entry);
    const entries = readAuditLog(path);
    expect(entries.map((line) => line.seq)).toEqual([1, 2]);
    expect(verifyAuditLog(path).ok).toBe(true);
  });

  it('returns an empty result for a missing log', () => {
    expect(verifyAuditLog(join(dir, 'missing.log'))).toEqual({ ok: true, entries: 0 });
  });
});
