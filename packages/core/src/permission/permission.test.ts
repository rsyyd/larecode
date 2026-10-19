import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Permissions } from './permission.js';
import { AuditLog, fileAuditSink } from './audit.js';

describe('Permissions', () => {
  it('allows allowed groups in ask mode', () => {
    const permissions = new Permissions({ mode: 'ask', allowedGroups: ['read'] });
    expect(permissions.check('read').allowed).toBe(true);
  });

  it('denies groups outside the allowed list in ask mode', () => {
    const permissions = new Permissions({ mode: 'ask', allowedGroups: ['read'] });
    expect(permissions.check('write').allowed).toBe(false);
  });

  it('allows everything in allow mode', () => {
    const permissions = new Permissions({ mode: 'allow', allowedGroups: [] });
    expect(permissions.check('shell').allowed).toBe(true);
  });

  it('denies everything in deny mode', () => {
    const permissions = new Permissions({ mode: 'deny', allowedGroups: ['read'] });
    expect(permissions.check('read').allowed).toBe(false);
  });

  it('default-denies unattended flows without a pre-authorized bundle', () => {
    const permissions = new Permissions({ mode: 'ask', allowedGroups: ['read'] });
    const decision = permissions.check('shell', { unattended: true });
    expect(decision.allowed).toBe(false);
  });

  it('allows pre-authorized groups in unattended flows', () => {
    const permissions = new Permissions({
      mode: 'ask',
      allowedGroups: ['read'],
      preAuthorized: { cron: ['read', 'shell'] },
    });
    expect(permissions.check('shell', { unattended: true }).allowed).toBe(true);
  });

  it('never pre-authorizes destructive or secrets in unattended flows', () => {
    const permissions = new Permissions({
      mode: 'ask',
      allowedGroups: ['read'],
      preAuthorized: { cron: ['destructive', 'secrets', 'read'] },
    });
    expect(permissions.check('destructive', { unattended: true }).allowed).toBe(false);
    expect(permissions.check('secrets', { unattended: true }).allowed).toBe(false);
  });

  it('never auto-approves destructive or secrets listed in allowedGroups', () => {
    const permissions = new Permissions({
      mode: 'ask',
      allowedGroups: ['destructive', 'secrets'],
    });
    const destructive = permissions.check('destructive');
    expect(destructive.allowed).toBe(false);
    expect(destructive.requiresConfirmation).toBe(true);
    expect(permissions.check('secrets').allowed).toBe(false);
  });

  it('never auto-approves destructive or secrets in allow mode', () => {
    const permissions = new Permissions({ mode: 'allow', allowedGroups: [] });
    expect(permissions.check('destructive').allowed).toBe(false);
    expect(permissions.check('secrets').allowed).toBe(false);
  });

  it('allows destructive only after explicit user confirmation', () => {
    const permissions = new Permissions({ mode: 'ask', allowedGroups: ['read'] });
    expect(permissions.check('destructive', { confirmedByUser: true }).allowed).toBe(true);
    expect(permissions.check('destructive').allowed).toBe(false);
  });

  it('does not let confirmation bypass unattended flows', () => {
    const permissions = new Permissions({ mode: 'allow', allowedGroups: [] });
    const decision = permissions.check('secrets', { unattended: true, confirmedByUser: true });
    expect(decision.allowed).toBe(false);
  });

  it('keeps deny mode authoritative even with confirmation', () => {
    const permissions = new Permissions({ mode: 'deny', allowedGroups: ['read'] });
    expect(permissions.check('secrets', { confirmedByUser: true }).allowed).toBe(false);
  });

  it('flags requiresConfirmation for ask-mode misses', () => {
    const permissions = new Permissions({ mode: 'ask', allowedGroups: ['read'] });
    const decision = permissions.check('write');
    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
  });
});

describe('Permissions audit', () => {
  it('records every decision with its context', () => {
    const permissions = new Permissions({ mode: 'ask', allowedGroups: ['read'] });
    permissions.check('read', { source: 'read tool' });
    permissions.check('shell');

    const { entries } = permissions.getAuditLog();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      group: 'read',
      allowed: true,
      source: 'read tool',
      unattended: false,
      confirmedByUser: false,
    });
    expect(entries[1]).toMatchObject({
      group: 'shell',
      allowed: false,
      requiresConfirmation: true,
    });
    expect(entries[1].timestamp).toBeGreaterThan(0);
  });

  it('redacts secrets in audit sources and reasons', () => {
    const permissions = new Permissions({ mode: 'ask', allowedGroups: ['read'] });
    permissions.check('shell', { source: 'deploy --api_key=sk-abcdef1234567890' });
    const entry = permissions.getAuditLog().entries[0];
    expect(entry.source).toContain('[REDACTED]');
    expect(entry.source).not.toContain('sk-abcdef1234567890');
  });

  it('persists audit entries as JSONL through the file sink', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lare-audit-'));
    const path = join(dir, 'nested', 'audit.jsonl');
    const permissions = new Permissions(
      { mode: 'ask', allowedGroups: ['read'] },
      new AuditLog([fileAuditSink(path)])
    );

    permissions.check('read');
    permissions.check('secrets', { unattended: true });

    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]) as { group: string; allowed: boolean };
    expect(first.group).toBe('read');
    expect(first.allowed).toBe(true);
    const second = JSON.parse(lines[1]) as { group: string; allowed: boolean };
    expect(second.group).toBe('secrets');
    expect(second.allowed).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });
});
