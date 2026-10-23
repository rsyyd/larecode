import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  isComplexTask,
  larecodeHome,
  loadEffectiveConfig,
  parseSkillDraft,
  parseSkillFile,
  providersFromConfig,
  Sessions,
  SKILL_FILE,
  Skills,
  slugifySkillName,
  transcriptOf,
  writeSkillDraft,
  type Config,
  type Session,
  type SkillDraft,
} from '@larecode/core';

const runGit = promisify(execFile);

export interface SkillAuthorOptions {
  provider?: string;
  model?: string;
  json?: boolean;
}

export interface SkillAuthorDeps {
  config?: Config;
  session?: Session;
  complete?: (prompt: string, options: { model: string; systemPrompt: string }) => Promise<string>;
  write?: (draft: SkillDraft) => string;
}

const SYSTEM_PROMPT =
  'You turn a finished coding session into a reusable skill. Return only a JSON object with name, description, and body. Use a lowercase hyphenated name, a one-sentence description under 140 characters that starts with "Use when", and a concise markdown body with the steps that actually worked. Do not invent commands.';

function promptFor(transcript: string): string {
  return `Summarize this session as a reusable skill.\n\nTranscript:\n${transcript}`;
}

function write(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function fail(message: string): number {
  process.stderr.write(`larecode: ${message}\n`);
  return 1;
}

export async function skillAuthorCommand(
  id: string,
  options: SkillAuthorOptions = {},
  deps: SkillAuthorDeps = {}
): Promise<number> {
  const config = deps.config ?? loadEffectiveConfig();
  const session = deps.session ?? new Sessions().get(id);
  if (!session) return fail(`session "${id}" not found`);
  if (!isComplexTask(session.messages)) {
    return fail(
      `session "${id}" is too simple to turn into a skill; it needs at least 4 turns and 3 tool calls`
    );
  }
  const provider = options.provider ?? session.metadata.provider ?? config.defaultProvider;
  const model = options.model ?? session.metadata.model ?? config.defaultModel;
  const complete =
    deps.complete ??
    ((prompt, completionOptions) => {
      const adapter = providersFromConfig(config).find((entry) => entry.name === provider);
      if (!adapter) throw new Error(`provider "${provider}" is not configured`);
      return adapter.complete(prompt, completionOptions);
    });
  try {
    const response = await complete(promptFor(transcriptOf(session.messages)), {
      model,
      systemPrompt: SYSTEM_PROMPT,
    });
    const draft = parseSkillDraft(response);
    const path = (deps.write ?? writeSkillDraft)(draft);
    if (options.json) {
      write(JSON.stringify({ name: draft.name, path }, null, 2));
    } else {
      write(`wrote ${path}`);
      write('review it, then change state: draft to state: active when ready');
    }
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export interface SkillInstallDeps {
  skillsDir?: string;
  git?: (url: string, destination: string) => Promise<void>;
}

export interface SkillListDeps {
  projectDir?: string;
  skills?: Skills;
}

function isGitUrl(source: string): boolean {
  return /^(https?:\/\/|git@|file:\/\/)/.test(source) || source.endsWith('.git');
}

function skillDirsIn(root: string): string[] {
  if (existsSync(join(root, SKILL_FILE))) return [root];
  const dirs: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(root, entry.name, SKILL_FILE))) {
      dirs.push(join(root, entry.name));
    }
  }
  return dirs;
}

export async function skillInstallCommand(
  source: string,
  options: { json?: boolean } = {},
  deps: SkillInstallDeps = {}
): Promise<number> {
  const skillsDir = deps.skillsDir ?? join(larecodeHome(), 'skills');
  const git =
    deps.git ??
    (async (url, destination) => {
      await runGit('git', ['clone', '--depth', '1', url, destination]);
    });

  let sourceDir: string;
  let cleanup: (() => void) | undefined;
  try {
    if (isGitUrl(source)) {
      const destination = await mkdtempSync(join(tmpdir(), 'lare-skill-src-'));
      cleanup = () => rmSync(destination, { recursive: true, force: true });
      try {
        await git(source, destination);
      } catch (error) {
        return fail(
          `could not clone ${source}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      sourceDir = destination;
    } else if (existsSync(source)) {
      sourceDir = source;
    } else {
      return fail(`"${source}" is not a readable directory or a git URL`);
    }

    const candidates = skillDirsIn(sourceDir);
    if (candidates.length === 0) {
      return fail(`no ${SKILL_FILE} found in ${source}`);
    }

    const installed: Array<{ name: string; path: string }> = [];
    const skipped: string[] = [];
    for (const dir of candidates) {
      const parsed = parseSkillFile(readFileSync(join(dir, SKILL_FILE), 'utf8'));
      const name = parsed?.frontmatter.name;
      const description = parsed?.frontmatter.description;
      if (!parsed || !name || !description) {
        return fail(`${join(dir, SKILL_FILE)} is missing a name or description`);
      }
      const target = join(skillsDir, slugifySkillName(name));
      if (existsSync(target)) {
        skipped.push(slugifySkillName(name));
        continue;
      }
      cpSync(dir, target, {
        recursive: true,
        filter: (entry) => !entry.startsWith(join(dir, '.git')),
      });
      installed.push({ name: slugifySkillName(name), path: target });
    }

    if (installed.length === 0) {
      return fail(`nothing installed; already present: ${skipped.join(', ')}`);
    }
    if (options.json) {
      write(JSON.stringify(installed, null, 2));
    } else {
      for (const skill of installed) write(`installed ${skill.name} at ${skill.path}`);
      for (const name of skipped) write(`skipped ${name}: already installed`);
      write('skills are untrusted; the first load still asks for consent');
    }
    return 0;
  } finally {
    cleanup?.();
  }
}

export function skillListCommand(
  options: { json?: boolean } = {},
  deps: SkillListDeps = {}
): number {
  const skills = deps.skills ?? new Skills({ projectDir: deps.projectDir ?? process.cwd() });
  const discovered = skills.refresh();
  if (options.json) {
    write(
      JSON.stringify(
        discovered.map((skill) => ({
          name: skill.name,
          description: skill.description,
          version: skill.version,
          state: skill.state,
          status: skill.status,
          source: skill.source,
          bundled: skill.bundled,
          dir: skill.dir,
        })),
        null,
        2
      )
    );
    return 0;
  }
  if (discovered.length === 0) {
    write('no skills found');
    return 0;
  }
  for (const skill of discovered) {
    write(`${skill.name}  ${skill.state}/${skill.status}  ${skill.description}`);
  }
  if (discovered.some((skill) => skill.status !== 'active')) {
    write('non-active skills stay hidden until approved or, for drafts, marked active');
  }
  return 0;
}
