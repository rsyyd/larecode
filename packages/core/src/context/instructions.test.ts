import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { consentToFile, discoverInstructions } from './instructions.js';

let home: string;
let project: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lumpscode-consent-'));
  project = mkdtempSync(join(tmpdir(), 'lumpscode-project-'));
  process.env.LUMPSCODE_HOME = home;
});

afterEach(() => {
  delete process.env.LUMPSCODE_HOME;
});

describe('instructions', () => {
  it('discovers instruction files in a project', () => {
    writeFileSync(join(project, 'AGENTS.md'), 'be kind');
    writeFileSync(join(project, 'CLAUDE.md'), 'be careful');
    const files = discoverInstructions(project);
    expect(files.map((f) => f.relative)).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(files.every((f) => f.status === 'pending')).toBe(true);
  });

  it('marks consented files as consented', () => {
    writeFileSync(join(project, 'AGENTS.md'), 'be kind');
    consentToFile(join(project, 'AGENTS.md'));
    expect(discoverInstructions(project)[0].status).toBe('consented');
  });

  it('detects changed files after consent (hash-bound trust)', () => {
    writeFileSync(join(project, 'AGENTS.md'), 'be kind');
    consentToFile(join(project, 'AGENTS.md'));
    appendFileSync(join(project, 'AGENTS.md'), '\nbe strict');
    expect(discoverInstructions(project)[0].status).toBe('changed');
  });

  it('ignores files that are not instruction files', () => {
    writeFileSync(join(project, 'README.md'), 'hello');
    expect(discoverInstructions(project)).toEqual([]);
  });
});
