import { describe, expect, it } from 'vitest';
import { PermissionEngine } from './engine.js';

describe('PermissionEngine', () => {
  it('allows allowed groups in ask mode', () => {
    const engine = new PermissionEngine({ mode: 'ask', allowedGroups: ['read'] });
    expect(engine.check('read').allowed).toBe(true);
  });

  it('denies groups outside the allowed list in ask mode', () => {
    const engine = new PermissionEngine({ mode: 'ask', allowedGroups: ['read'] });
    expect(engine.check('write').allowed).toBe(false);
  });

  it('allows everything in allow mode', () => {
    const engine = new PermissionEngine({ mode: 'allow', allowedGroups: [] });
    expect(engine.check('shell').allowed).toBe(true);
  });

  it('denies everything in deny mode', () => {
    const engine = new PermissionEngine({ mode: 'deny', allowedGroups: ['read'] });
    expect(engine.check('read').allowed).toBe(false);
  });

  it('default-denies unattended flows without a pre-authorized bundle', () => {
    const engine = new PermissionEngine({ mode: 'ask', allowedGroups: ['read'] });
    const decision = engine.check('shell', { unattended: true });
    expect(decision.allowed).toBe(false);
  });

  it('allows pre-authorized groups in unattended flows', () => {
    const engine = new PermissionEngine({
      mode: 'ask',
      allowedGroups: ['read'],
      preAuthorized: { cron: ['read', 'shell'] },
    });
    expect(engine.check('shell', { unattended: true }).allowed).toBe(true);
  });

  it('never pre-authorizes destructive or secrets in unattended flows', () => {
    const engine = new PermissionEngine({
      mode: 'ask',
      allowedGroups: ['read'],
      preAuthorized: { cron: ['destructive', 'secrets', 'read'] },
    });
    expect(engine.check('destructive', { unattended: true }).allowed).toBe(false);
    expect(engine.check('secrets', { unattended: true }).allowed).toBe(false);
  });
});
