import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Skills,
  discoverSkills,
  parseSkillFile,
  skillConsentPath,
  type SkillsOptions,
} from './skill.js';
import { skillTool } from '../tool/skill.js';
import { Tools, type ToolContext } from '../tool/tool.js';
import { Permissions, type PermissionPolicy } from '../permission/permission.js';
import { Logger } from '../logger/logger.js';

const quiet = () => new Logger({ level: 'error', handlers: [() => {}] });

function writeSkill(
  dir: string,
  name: string,
  options: { description?: string; body?: string } = {}
): string {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const path = join(skillDir, 'SKILL.md');
  writeFileSync(
    path,
    `---\nname: ${name}\ndescription: ${options.description ?? `Use ${name} when testing`}\nversion: 1.0.0\n---\n\n${options.body ?? `# ${name}\n\nSteps for ${name}.`}\n`
  );
  return path;
}

let root: string;
let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumps-skill-'));
  home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  previousHome = process.env.LUMPSCODE_HOME;
  process.env.LUMPSCODE_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.LUMPSCODE_HOME;
  else process.env.LUMPSCODE_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

function setupProject(): { project: string; bundled: string } {
  const project = join(root, 'project');
  const bundled = join(root, 'bundled');
  mkdirSync(project, { recursive: true });
  writeSkill(join(project, '.lumpscode', 'skills'), 'alpha', { body: 'Alpha instructions.' });
  writeSkill(join(project, '.agents', 'skills'), 'beta');
  writeSkill(join(home, 'skills'), 'gamma');
  writeSkill(bundled, 'delta', { body: 'Bundled instructions.' });
  return { project, bundled };
}

function options(project: string, bundled: string): SkillsOptions {
  return { projectDir: project, bundledDir: bundled };
}

function ctx(policy?: PermissionPolicy): ToolContext {
  return {
    sessionId: 'test-session',
    workingDir: '/tmp',
    permissions: new Permissions(policy),
    abortSignal: new AbortController().signal,
  };
}

describe('parseSkillFile', () => {
  it('parses frontmatter and body', () => {
    const parsed = parseSkillFile(
      '---\nname: alpha\ndescription: "Quoted: description"\nversion: 2.0.0\n---\nBody text\n'
    );
    expect(parsed?.frontmatter).toEqual({
      name: 'alpha',
      description: 'Quoted: description',
      version: '2.0.0',
    });
    expect(parsed?.body).toBe('Body text');
  });

  it('returns null without frontmatter', () => {
    expect(parseSkillFile('no frontmatter here')).toBeNull();
  });
});

describe('skills discovery', () => {
  it('discovers project, user, and bundled skills with statuses', () => {
    const { project, bundled } = setupProject();
    const found = discoverSkills(project, { bundledDir: bundled });
    const byName = Object.fromEntries(found.map((skill) => [skill.name, skill]));
    expect(Object.keys(byName).sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(byName.alpha.status).toBe('pending');
    expect(byName.beta.status).toBe('pending');
    expect(byName.gamma.status).toBe('pending');
    expect(byName.delta.status).toBe('active');
    expect(byName.delta.bundled).toBe(true);
  });

  it('gives project dirs precedence on name conflicts', () => {
    const { project, bundled } = setupProject();
    writeSkill(join(project, '.agents', 'skills'), 'alpha', { body: 'Shadowed.' });
    const found = discoverSkills(project, { bundledDir: bundled });
    const alpha = found.find((skill) => skill.name === 'alpha');
    expect(alpha?.body).toBe('Alpha instructions.');
  });

  it('skips directories without a valid SKILL.md', () => {
    const { project, bundled } = setupProject();
    const broken = join(project, '.lumpscode', 'skills', 'broken');
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, 'SKILL.md'), 'no frontmatter');
    const found = discoverSkills(project, { bundledDir: bundled });
    expect(found.map((skill) => skill.name)).not.toContain('broken');
  });
});

describe('skills consent and integrity', () => {
  it('keeps pending skills hidden until approved', () => {
    const { project, bundled } = setupProject();
    const skills = new Skills(options(project, bundled));
    skills.refresh();
    expect(skills.list().map((skill) => skill.name)).toEqual(['delta']);
    expect(() => skills.load('alpha')).toThrowError(/pending approval/);
    expect(skills.approve('alpha')).toBe(true);
    expect(
      skills
        .list()
        .map((skill) => skill.name)
        .sort()
    ).toEqual(['alpha', 'delta']);
    expect(skills.load('alpha')).toContain('Alpha instructions.');
  });

  it('rejects a skill whose hash changed after approval', () => {
    const { project, bundled } = setupProject();
    const skills = new Skills(options(project, bundled));
    skills.refresh();
    skills.approve('alpha');
    expect(skills.load('alpha')).toContain('Alpha instructions.');

    writeSkill(join(project, '.lumpscode', 'skills'), 'alpha', { body: 'Tampered instructions.' });
    expect(() => skills.load('alpha')).toThrowError(/changed on disk/);

    const found = skills.refresh();
    expect(found.find((skill) => skill.name === 'alpha')?.status).toBe('changed');
    expect(skills.list().map((skill) => skill.name)).toEqual(['delta']);
    expect(() => skills.load('alpha')).toThrowError(/changed on disk/);

    expect(skills.approve('alpha')).toBe(true);
    expect(skills.load('alpha')).toContain('Tampered instructions.');
  });

  it('reports unknown skills and writes consent outside the repo', () => {
    const { project, bundled } = setupProject();
    const skills = new Skills(options(project, bundled));
    skills.refresh();
    expect(() => skills.load('nope')).toThrowError(/not found/);
    skills.approve('beta');
    expect(skillConsentPath()).toBe(join(home, 'skill-consent.json'));
  });
});

describe('progressive disclosure budgets', () => {
  it('keeps the catalog inside its budget', () => {
    const { project, bundled } = setupProject();
    for (const name of ['one', 'two', 'three', 'four']) {
      writeSkill(join(project, '.lumpscode', 'skills'), name, { description: 'short' });
    }
    const skills = new Skills(options(project, bundled));
    for (const entry of skills.refresh()) skills.approve(entry.name);
    const catalog = skills.catalog(32);
    expect(catalog).toMatch(/\(\+\d+ more skills\)/);
    expect(catalog.length).toBeLessThanOrEqual(32 + 20);
  });

  it('truncates oversized skill bodies on load', () => {
    const { project, bundled } = setupProject();
    writeSkill(join(project, '.lumpscode', 'skills'), 'big', { body: 'b'.repeat(9000) });
    const skills = new Skills(options(project, bundled));
    skills.refresh();
    skills.approve('big');
    const loaded = skills.load('big');
    expect(loaded.endsWith('[skill truncated at 8000 chars]')).toBe(true);
    expect(loaded.length).toBeLessThanOrEqual(8100);
    const small = skills.load('big', 100);
    expect(small.endsWith('[skill truncated at 100 chars]')).toBe(true);
  });
});

describe('skill tool', () => {
  function tools(): Tools {
    const { project, bundled } = setupProject();
    const skills = new Skills(options(project, bundled));
    skills.refresh();
    skills.approve('alpha');
    const registry = new Tools({ logger: quiet() });
    registry.register(skillTool(skills));
    return registry;
  }

  it('lists active skills without a permission check', async () => {
    const result = await tools().execute(
      { id: 'c1', name: 'skill', arguments: { action: 'list' } },
      ctx()
    );
    expect(result.success).toBe(true);
    const output = result.output as { skills: Array<{ name: string }> };
    expect(output.skills.map((skill) => skill.name).sort()).toEqual(['alpha', 'delta']);
  });

  it('denies loads by default and allows them with the skills group', async () => {
    const denied = await tools().execute(
      { id: 'c2', name: 'skill', arguments: { action: 'load', name: 'alpha' } },
      ctx()
    );
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('PERMISSION_DENIED');

    const allowed = await tools().execute(
      { id: 'c3', name: 'skill', arguments: { action: 'load', name: 'alpha' } },
      ctx({ mode: 'ask', allowedGroups: ['read', 'skills'] })
    );
    expect(allowed.success).toBe(true);
    expect(allowed.output).toMatchObject({ name: 'alpha' });
    expect((allowed.output as { instructions: string }).instructions).toContain(
      'Alpha instructions.'
    );
  });

  it('validates the action and name', async () => {
    const badAction = await tools().execute(
      { id: 'c4', name: 'skill', arguments: { action: 'run' } },
      ctx({ mode: 'ask', allowedGroups: ['skills'] })
    );
    expect(badAction.success).toBe(false);
    expect(badAction.error).toContain('action');

    const noName = await tools().execute(
      { id: 'c5', name: 'skill', arguments: { action: 'load' } },
      ctx({ mode: 'ask', allowedGroups: ['skills'] })
    );
    expect(noName.success).toBe(false);
    expect(noName.error).toContain('name');
  });
});
