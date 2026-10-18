import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sessions, renderSessionContext } from './session.js';
import { LumpsError } from '../error/error.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lumpscode-sessions-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Sessions persistence', () => {
  it('persists a session on create and reloads it from a fresh instance', () => {
    const sessions = new Sessions(dir);
    const created = sessions.create('hello there');
    created.messages.push({
      role: 'assistant',
      content: 'hi, how can I help',
      timestamp: new Date('2026-10-18T10:00:00Z'),
    });
    sessions.save(created);

    const resumed = new Sessions(dir).get(created.id);
    expect(resumed).toBeDefined();
    expect(resumed!.id).toBe(created.id);
    expect(resumed!.messages).toHaveLength(2);
    expect(resumed!.messages[1].content).toBe('hi, how can I help');
    expect(resumed!.messages[1].timestamp).toEqual(new Date('2026-10-18T10:00:00Z'));
    expect(resumed!.metadata.createdAt).toBeInstanceOf(Date);
    expect(resumed!.metadata.messageCount).toBe(2);
  });

  it('reproduces the context after resume', () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('fix the failing test');
    session.messages.push(
      {
        role: 'assistant',
        content: 'running the suite',
        toolCalls: [{ id: 'call-1', name: 'bash', arguments: { command: 'npm test' } }],
        timestamp: new Date(),
      },
      {
        role: 'tool',
        content: '3 tests failed',
        toolResults: [{ id: 'call-1', success: true, output: '3 tests failed' }],
        timestamp: new Date(),
      }
    );
    sessions.save(session);
    const before = renderSessionContext(session);

    const fresh = new Sessions(dir);
    const resumed = fresh.get(session.id)!;
    expect(renderSessionContext(resumed)).toBe(before);
    expect(resumed.messages[2].toolResults?.[0]).toEqual({
      id: 'call-1',
      success: true,
      output: '3 tests failed',
    });
  });

  it('redacts secrets on disk while keeping them in memory', () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('deploy with export API_KEY=sk-ant-abcdef1234567890 now');
    session.messages.push({
      role: 'assistant',
      content: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456 accepted',
      timestamp: new Date(),
    });
    sessions.save(session);

    const raw = readFileSync(join(dir, `${session.id}.json`), 'utf8');
    expect(raw).not.toContain('sk-ant-abcdef1234567890');
    expect(raw).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(raw).toContain('[REDACTED]');
    expect(session.messages[0].content).toContain('sk-ant-abcdef1234567890');

    const resumed = new Sessions(dir).get(session.id)!;
    expect(resumed.messages[0].content).not.toContain('sk-ant-abcdef1234567890');
  });

  it('writes files with owner-only permissions', () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('x');
    const mode = statSync(join(dir, `${session.id}.json`)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('lists session metadata newest first and skips corrupt files', async () => {
    const sessions = new Sessions(dir);
    const first = sessions.create('one');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = sessions.create('two');
    writeFileSync(join(dir, 'broken.json'), '{not json');

    const listed = new Sessions(dir).list();
    expect(listed.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(listed.every((entry) => entry.updatedAt instanceof Date)).toBe(true);
  });

  it('throws SESSION_CORRUPTED for a corrupt session file', () => {
    writeFileSync(join(dir, 'bad.json'), 'oops');
    const sessions = new Sessions(dir);
    try {
      sessions.get('bad');
      expect.unreachable('expected get to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(LumpsError);
      expect((error as LumpsError).code).toBe('SESSION_CORRUPTED');
    }
  });

  it('deletes from disk and memory and rejects path-unsafe ids', () => {
    const sessions = new Sessions(dir);
    const session = sessions.create('gone soon');
    expect(sessions.delete(session.id)).toBe(true);
    expect(new Sessions(dir).get(session.id)).toBeUndefined();
    expect(sessions.get('../../etc/passwd')).toBeUndefined();
    expect(sessions.delete('../../etc/passwd')).toBe(false);
  });
});
