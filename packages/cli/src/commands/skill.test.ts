import { describe, expect, it, vi } from 'vitest';
import type { Config, Session, SessionMessage, SkillDraft } from '@larecode/core';
import { skillAuthorCommand } from './skill.js';

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
