import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { LumpsError } from '../error/error.js';
import type { SessionMessage } from '../session/session.js';
import { SKILL_BODY_MAX_CHARS, SKILL_FILE } from './skill.js';

export const COMPLEX_TASK_MIN_TURNS = 4;
export const COMPLEX_TASK_MIN_TOOL_CALLS = 3;
export const AUTHOR_TRANSCRIPT_MAX_CHARS = 20_000;
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SKILL_DESCRIPTION_MAX_CHARS = 140;

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

export interface AuthorSkillOptions {
  messages: SessionMessage[];
  summarize: (transcript: string) => Promise<SkillDraft>;
  projectDir?: string;
  minTurns?: number;
  minToolCalls?: number;
}

export function isComplexTask(
  messages: SessionMessage[],
  options: { minTurns?: number; minToolCalls?: number } = {}
): boolean {
  const turns = messages.filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  ).length;
  const toolCalls = messages.reduce((sum, message) => sum + (message.toolCalls?.length ?? 0), 0);
  return (
    turns >= (options.minTurns ?? COMPLEX_TASK_MIN_TURNS) &&
    toolCalls >= (options.minToolCalls ?? COMPLEX_TASK_MIN_TOOL_CALLS)
  );
}

export function slugifySkillName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

export function skillDraftPath(name: string, projectDir = process.cwd()): string {
  return join(resolve(projectDir), '.lumpscode', 'skills', name, SKILL_FILE);
}

export function renderSkillDraft(draft: SkillDraft): string {
  const description = draft.description
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SKILL_DESCRIPTION_MAX_CHARS);
  const body =
    draft.body.length > SKILL_BODY_MAX_CHARS
      ? `${draft.body.slice(0, SKILL_BODY_MAX_CHARS).trim()}\n`
      : draft.body.trim();
  return `---\nname: ${draft.name}\ndescription: ${description}\nversion: 0.1.0\nstate: draft\n---\n\n${body}\n`;
}

export function writeSkillDraft(draft: SkillDraft, options: { projectDir?: string } = {}): string {
  const name = slugifySkillName(draft.name);
  if (!SKILL_NAME_RE.test(name)) {
    throw new LumpsError('SKILL_WRITE_FAILED', `invalid skill name: "${draft.name}"`);
  }
  if (draft.description.replace(/\s+/g, ' ').trim() === '') {
    throw new LumpsError('SKILL_WRITE_FAILED', `skill "${name}" needs a description`);
  }
  if (draft.body.trim() === '') {
    throw new LumpsError('SKILL_WRITE_FAILED', `skill "${name}" needs a body`);
  }
  const path = skillDraftPath(name, options.projectDir);
  if (existsSync(path)) {
    throw new LumpsError('SKILL_WRITE_FAILED', `skill "${name}" already exists`, {
      context: { path },
    });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderSkillDraft({ ...draft, name }), { mode: 0o644 });
  return path;
}

export function transcriptOf(messages: SessionMessage[]): string {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n')
    .slice(-AUTHOR_TRANSCRIPT_MAX_CHARS);
}

export async function authorSkill(
  options: AuthorSkillOptions
): Promise<{ path: string; name: string } | null> {
  if (!isComplexTask(options.messages, options)) return null;
  const transcript = transcriptOf(options.messages);
  if (transcript.trim() === '') return null;
  const draft = await options.summarize(transcript);
  const path = writeSkillDraft(draft, { projectDir: options.projectDir });
  return { path, name: slugifySkillName(draft.name) };
}
