import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from '../session/session.js';
import { Skills, parseSkillFile, SKILL_BODY_MAX_CHARS } from './skill.js';
import {
  authorSkill,
  isComplexTask,
  renderSkillDraft,
  skillDraftPath,
  slugifySkillName,
  writeSkillDraft,
} from './author.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'lare-author-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function message(role: SessionMessage['role'], content: string, toolCalls = 0): SessionMessage {
  return {
    role,
    content,
    timestamp: new Date(),
    toolCalls: Array.from({ length: toolCalls }, (_, index) => ({
      id: `call-${index}`,
      name: 'bash',
      arguments: { command: 'ls' },
    })),
  };
}

const TRANSCRIPT: SessionMessage[] = [
  message('user', 'Fix the deploy pipeline', 0),
  message('assistant', 'Checking the pipeline', 2),
  message('user', 'Also add a smoke test', 0),
  message('assistant', 'Pipeline fixed', 1),
];

describe('slugifySkillName', () => {
  it('normalizes names for directories', () => {
    expect(slugifySkillName('Deploy To Kubernetes!')).toBe('deploy-to-kubernetes');
    expect(slugifySkillName('  --x--  ')).toBe('x');
  });
});

describe('isComplexTask', () => {
  it('requires enough turns and tool calls', () => {
    expect(isComplexTask(TRANSCRIPT)).toBe(true);
    expect(isComplexTask(TRANSCRIPT.slice(0, 3))).toBe(false);
    expect(isComplexTask([message('user', 'a'), message('assistant', 'b')])).toBe(false);
    expect(isComplexTask(TRANSCRIPT, { minTurns: 10 })).toBe(false);
  });
});

describe('writeSkillDraft', () => {
  it('writes a draft SKILL.md with frontmatter', async () => {
    const path = writeSkillDraft(
      {
        name: 'Deploy To Kubernetes',
        description: 'Use when deploying services',
        body: 'Step one\nStep two',
      },
      { projectDir }
    );
    expect(path).toBe(skillDraftPath('deploy-to-kubernetes', projectDir));
    const parsed = parseSkillFile(await readFile(path, 'utf8'));
    expect(parsed?.frontmatter).toMatchObject({
      name: 'deploy-to-kubernetes',
      description: 'Use when deploying services',
      version: '0.1.0',
      state: 'draft',
    });
    expect(parsed?.body).toBe('Step one\nStep two');
  });

  it('truncates oversized bodies', () => {
    const rendered = renderSkillDraft({
      name: 'big',
      description: 'd',
      body: 'x'.repeat(SKILL_BODY_MAX_CHARS + 500),
    });
    const parsed = parseSkillFile(rendered);
    expect(parsed?.body.length).toBeLessThanOrEqual(SKILL_BODY_MAX_CHARS);
  });

  it('rejects invalid drafts and existing skills', () => {
    expect(() =>
      writeSkillDraft({ name: '***', description: 'd', body: 'b' }, { projectDir })
    ).toThrow(/invalid skill name/);
    expect(() =>
      writeSkillDraft({ name: 'ok', description: ' ', body: 'b' }, { projectDir })
    ).toThrow(/description/);
    expect(() =>
      writeSkillDraft({ name: 'ok2', description: 'd', body: '  ' }, { projectDir })
    ).toThrow(/body/);
    const draft = { name: 'dupe', description: 'd', body: 'b' };
    writeSkillDraft(draft, { projectDir });
    expect(() => writeSkillDraft(draft, { projectDir })).toThrow(/already exists/);
  });
});

describe('authorSkill', () => {
  it('does nothing for simple tasks without calling the model', async () => {
    const summarize = vi.fn();
    const result = await authorSkill({
      messages: TRANSCRIPT.slice(0, 2),
      summarize,
      projectDir,
    });
    expect(result).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
  });

  it('authors a pending draft skill after a complex task', async () => {
    const summarize = vi.fn(async (transcript: string) => {
      expect(transcript).toContain('user: Fix the deploy pipeline');
      expect(transcript).toContain('assistant: Pipeline fixed');
      return {
        name: 'Fix deploy pipeline',
        description: 'Use when the deploy pipeline fails',
        body: '1. Inspect logs\n2. Patch the workflow\n3. Add a smoke test',
      };
    });

    const result = await authorSkill({ messages: TRANSCRIPT, summarize, projectDir });
    expect(result?.name).toBe('fix-deploy-pipeline');
    expect(result?.path).toBe(skillDraftPath('fix-deploy-pipeline', projectDir));

    const skills = new Skills({ projectDir, consentPath: join(projectDir, 'consent.json') });
    const discovered = skills.refresh().find((skill) => skill.name === 'fix-deploy-pipeline');
    expect(discovered?.status).toBe('pending');
    expect(skills.get('fix-deploy-pipeline')).toBeUndefined();

    expect(skills.approve('fix-deploy-pipeline')).toBe(true);
    expect(skills.get('fix-deploy-pipeline')?.prompt).toContain('Add a smoke test');
  });
});
