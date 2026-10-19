import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Skills,
  discoverSkills,
  SKILL_BODY_MAX_CHARS,
  SKILL_CATALOG_MAX_CHARS,
} from '@larecode/core';
import { bundledSkillsDir } from './index.js';

let root: string;
let previousHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lare-bundle-'));
  previousHome = process.env.LARECODE_HOME;
  process.env.LARECODE_HOME = join(root, 'home');
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.LARECODE_HOME;
  else process.env.LARECODE_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

describe('bundled skills', () => {
  it('ships the default skill bundle with valid frontmatter', () => {
    const found = discoverSkills(join(root, 'project'), { bundledDir: bundledSkillsDir() });
    expect(found.map((skill) => skill.name).sort()).toEqual([
      'humanizer',
      'systematic-debugging',
      'test-driven-development',
      'verification-before-completion',
    ]);
    for (const skill of found) {
      expect(skill.status).toBe('active');
      expect(skill.bundled).toBe(true);
      expect(skill.description.length).toBeGreaterThan(20);
      expect(skill.body.length).toBeGreaterThan(200);
    }
  });

  it('loads bundled skills without consent and within budgets', () => {
    const skills = new Skills({
      projectDir: join(root, 'project'),
      bundledDir: bundledSkillsDir(),
    });
    skills.refresh();
    expect(skills.catalog().length).toBeLessThanOrEqual(SKILL_CATALOG_MAX_CHARS);
    for (const { name } of skills.list()) {
      const body = skills.load(name);
      expect(body.length).toBeGreaterThan(0);
      expect(body.length).toBeLessThanOrEqual(SKILL_BODY_MAX_CHARS + 50);
    }
  });
});
