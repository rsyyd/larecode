import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, Session, SessionMessage, SkillDraft } from '@larecode/core';
import { Skills } from '@larecode/core';
import { skillAuthorCommand, skillInstallCommand, skillListCommand } from './skill.js';

const now = new Date('2026-10-23T00:00:00Z');

function message(role: SessionMessage['role'], content: string, toolCalls = 0): SessionMessage {
  return {
    role,
    content,
    timestamp: now,
    toolCalls: Array.from({ length: toolCalls }, (_, index) => ({
      id: `call-${index}`,
      name: 'bash',
      arguments: { command: 'ls' },
    })),
  };
}

function session(messages: SessionMessage[]): Session {
  return {
    id: 's1',
    metadata: {
      id: 's1',
      createdAt: now,
      updatedAt: now,
      messageCount: messages.length,
      tokenUsage: 0,
      cost: 0,
      provider: 'test',
      model: 'model',
    },
    messages,
  };
}

const COMPLEX = session([
  message('user', 'Fix the deploy pipeline'),
  message('assistant', 'Checking the workflow', 2),
  message('user', 'Add a smoke test'),
  message('assistant', 'Pipeline is fixed', 1),
]);

const DRAFT: SkillDraft = {
  name: 'Fix deploy pipeline',
  description: 'Use when the deploy pipeline fails',
  body: '1. Inspect logs\n2. Patch the workflow',
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  return {
    out,
    err,
    restore: () => {
      stdout.mockRestore();
      stderr.mockRestore();
    },
  };
}

describe('skill author command', () => {
  it('turns a complex session into a draft skill', async () => {
    const output = capture();
    const write = vi.fn(() => '/tmp/skills/fix-deploy-pipeline/SKILL.md');
    const complete = vi.fn(async (_prompt: string, options: { model: string }) => {
      expect(options.model).toBe('model');
      return '```json\n' + JSON.stringify(DRAFT) + '\n```';
    });
    try {
      const code = await skillAuthorCommand(
        's1',
        {},
        { config: {} as Config, session: COMPLEX, complete, write }
      );
      expect(code).toBe(0);
      expect(complete.mock.calls[0]?.[0]).toContain('user: Fix the deploy pipeline');
      expect(write).toHaveBeenCalledWith(DRAFT);
      expect(output.out.join('')).toContain('/tmp/skills/fix-deploy-pipeline/SKILL.md');
    } finally {
      output.restore();
    }
  });

  it('prints JSON with the skill name and path', async () => {
    const output = capture();
    try {
      const code = await skillAuthorCommand(
        's1',
        { json: true },
        {
          config: {} as Config,
          session: COMPLEX,
          complete: async () => JSON.stringify(DRAFT),
          write: () => '/tmp/skill/SKILL.md',
        }
      );
      expect(code).toBe(0);
      expect(JSON.parse(output.out.join(''))).toEqual({
        name: 'Fix deploy pipeline',
        path: '/tmp/skill/SKILL.md',
      });
    } finally {
      output.restore();
    }
  });

  it('refuses a simple session and a missing session', async () => {
    const output = capture();
    const complete = vi.fn();
    try {
      expect(
        await skillAuthorCommand(
          's1',
          {},
          { config: {} as Config, session: session([message('user', 'hi')]), complete }
        )
      ).toBe(1);
      expect(complete).not.toHaveBeenCalled();
      expect(await skillAuthorCommand('missing', {}, { config: {} as Config, complete })).toBe(1);
      expect(output.err.join('')).toMatch(/too simple/);
      expect(output.err.join('')).toMatch(/not found/);
    } finally {
      output.restore();
    }
  });

  it('reports an invalid model response without writing a skill', async () => {
    const output = capture();
    const write = vi.fn();
    try {
      const code = await skillAuthorCommand(
        's1',
        {},
        {
          config: {} as Config,
          session: COMPLEX,
          complete: async () => 'not json',
          write,
        }
      );
      expect(code).toBe(1);
      expect(write).not.toHaveBeenCalled();
      expect(output.err.join('')).toContain('JSON object');
    } finally {
      output.restore();
    }
  });
});

describe('skill install and list commands', () => {
  let work: string;
  let skillsDir: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'lare-skill-cli-'));
    skillsDir = mkdtempSync(join(tmpdir(), 'lare-skill-home-'));
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(skillsDir, { recursive: true, force: true });
  });

  function makeSkill(root: string, name: string, state = 'active'): string {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Use ${name} when testing\nversion: 1.0.0\nstate: ${state}\n---\n\n# ${name}\n\nSteps.\n`
    );
    return dir;
  }

  it('installs a skill from a local directory', async () => {
    const output = capture();
    try {
      const source = makeSkill(work, 'alpha');
      const code = await skillInstallCommand(source, {}, { skillsDir });
      expect(code).toBe(0);
      expect(existsSync(join(skillsDir, 'alpha', 'SKILL.md'))).toBe(true);
      expect(output.out.join('')).toContain('installed alpha');
      expect(output.out.join('')).toContain('asks for consent');
    } finally {
      output.restore();
    }
  });

  it('installs every skill in a community directory and reports JSON', async () => {
    const output = capture();
    try {
      makeSkill(work, 'one');
      makeSkill(work, 'two', 'draft');
      const code = await skillInstallCommand(work, { json: true }, { skillsDir });
      expect(code).toBe(0);
      const installed = JSON.parse(output.out.join('')) as Array<{ name: string }>;
      expect(installed.map((skill) => skill.name).sort()).toEqual(['one', 'two']);
    } finally {
      output.restore();
    }
  });

  it('refuses to overwrite an installed skill and rejects empty sources', async () => {
    const output = capture();
    try {
      const source = makeSkill(work, 'alpha');
      expect(await skillInstallCommand(source, {}, { skillsDir })).toBe(0);
      expect(await skillInstallCommand(source, {}, { skillsDir })).toBe(1);

      const empty = join(work, 'empty');
      mkdirSync(empty);
      expect(await skillInstallCommand(empty, {}, { skillsDir })).toBe(1);
      expect(await skillInstallCommand(join(work, 'missing'), {}, { skillsDir })).toBe(1);
      expect(output.err.join('')).toMatch(/nothing installed|no SKILL\.md found|not a readable/);
      expect(readFileSync(join(skillsDir, 'alpha', 'SKILL.md'), 'utf8')).toContain('alpha');
    } finally {
      output.restore();
    }
  });

  it('installs from a git URL without copying git metadata', async () => {
    const output = capture();
    try {
      const repo = join(work, 'repo');
      makeSkill(repo, 'beta');
      execSync(
        'git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init',
        {
          cwd: repo,
        }
      );
      const code = await skillInstallCommand(`file://${repo}`, {}, { skillsDir });
      expect(code).toBe(0);
      expect(existsSync(join(skillsDir, 'beta', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(skillsDir, 'beta', '.git'))).toBe(false);
    } finally {
      output.restore();
    }
  }, 30_000);

  it('lists discovered skills with state and approval status', () => {
    const output = capture();
    try {
      const project = join(work, 'project');
      makeSkill(join(project, '.larecode', 'skills'), 'active-skill');
      makeSkill(join(project, '.larecode', 'skills'), 'drafting', 'draft');
      const skills = new Skills({
        projectDir: project,
        consentPath: join(work, 'consent.json'),
      });
      expect(skillListCommand({}, { skills })).toBe(0);
      const text = output.out.join('');
      expect(text).toContain('active-skill  active/pending');
      expect(text).toContain('drafting  draft/pending');
      expect(text).toContain('hidden until approved');

      expect(skillListCommand({ json: true }, { skills })).toBe(0);
      const entries = JSON.parse(output.out.at(-1) ?? '') as Array<{
        name: string;
        state: string;
        status: string;
      }>;
      expect(entries.find((skill) => skill.name === 'drafting')?.state).toBe('draft');
    } finally {
      output.restore();
    }
  });
});
