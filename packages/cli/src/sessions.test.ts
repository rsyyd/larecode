import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sessions, checkpointsDir } from '@larecode/core';
import { Shares } from '@larecode/server';
import { sessionsRmCommand } from './commands/sessions.js';

let home: string;
let output: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lare-sessions-'));
  process.env.LARECODE_HOME = home;
  output = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LARECODE_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('sessions rm', () => {
  it('deletes the session, its checkpoints, and its share links', () => {
    const sessions = new Sessions();
    const target = sessions.create();
    const other = sessions.create();
    mkdirSync(join(checkpointsDir(), `scope-${target.id}.git`), { recursive: true });
    mkdirSync(join(checkpointsDir(), `scope-${other.id}.git`), { recursive: true });
    const shares = new Shares();
    shares.create(target.id);
    shares.create(other.id);

    expect(sessionsRmCommand(target.id)).toBe(0);

    expect(new Sessions().get(target.id)).toBeUndefined();
    expect(new Sessions().get(other.id)).toBeDefined();
    expect(existsSync(join(checkpointsDir(), `scope-${target.id}.git`))).toBe(false);
    expect(existsSync(join(checkpointsDir(), `scope-${other.id}.git`))).toBe(true);
    expect(shares.list().map((link) => link.sessionId)).toEqual([other.id]);
    expect(output.join('')).toContain(`deleted session ${target.id}`);
  });

  it('fails for an unknown session', () => {
    expect(sessionsRmCommand('missing')).toBe(1);
    expect(output.join('')).toContain('not found');
  });
});
