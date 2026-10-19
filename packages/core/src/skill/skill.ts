import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { larecodeHome } from '../config/config.js';
import { LareError } from '../error/error.js';

export type SkillState = 'draft' | 'active' | 'disabled';

export type SkillStatus = 'active' | 'pending' | 'changed';

export const SKILL_FILE = 'SKILL.md';
export const SKILL_CATALOG_MAX_CHARS = 1200;
export const SKILL_BODY_MAX_CHARS = 8000;
const DESCRIPTION_MAX_CHARS = 140;

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  state: SkillState;
  source: 'auto' | 'user';
}

export interface Skill extends SkillMetadata {
  prompt: string;
  hash: string;
}

export interface DiscoveredSkill {
  name: string;
  description: string;
  version: string;
  dir: string;
  path: string;
  hash: string;
  status: SkillStatus;
  bundled: boolean;
  source: 'auto' | 'user';
  body: string;
}

export interface SkillsOptions {
  projectDir?: string;
  bundledDir?: string;
  consentPath?: string;
}

export function skillConsentPath(): string {
  return join(larecodeHome(), 'skill-consent.json');
}

export function parseSkillFile(
  content: string
): { frontmatter: Record<string, string>; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return null;
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s/.test(line)) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && value) frontmatter[key] = value;
  }
  return { frontmatter, body: match[2].trim() };
}

function loadConsent(path: string): Record<string, string> {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : {};
}

export function consentToSkill(path: string, consentFile = skillConsentPath()): void {
  const consent = loadConsent(consentFile);
  consent[resolve(path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
  mkdirSync(dirname(consentFile), { recursive: true });
  writeFileSync(consentFile, JSON.stringify(consent, null, 2) + '\n', { mode: 0o600 });
  chmodSync(consentFile, 0o600);
}

export function discoverSkills(
  projectDir: string,
  options: { bundledDir?: string; consentPath?: string } = {}
): DiscoveredSkill[] {
  const consentFile = options.consentPath ?? skillConsentPath();
  const consent = loadConsent(consentFile);
  const dirs: Array<{ dir: string; bundled: boolean }> = [
    { dir: join(projectDir, '.larecode', 'skills'), bundled: false },
    { dir: join(projectDir, '.agents', 'skills'), bundled: false },
    { dir: join(larecodeHome(), 'skills'), bundled: false },
    ...(options.bundledDir ? [{ dir: options.bundledDir, bundled: true }] : []),
  ];
  const byName = new Map<string, DiscoveredSkill>();
  for (const { dir, bundled } of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name, SKILL_FILE);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, 'utf8');
      const parsed = parseSkillFile(content);
      const name = parsed?.frontmatter.name;
      const description = parsed?.frontmatter.description;
      if (!parsed || !name || !description) continue;
      if (byName.has(name)) continue;
      const hash = createHash('sha256').update(content).digest('hex');
      const known = consent[resolve(path)];
      const status: SkillStatus = bundled
        ? 'active'
        : known === undefined
          ? 'pending'
          : known === hash
            ? 'active'
            : 'changed';
      byName.set(name, {
        name,
        description,
        version: parsed.frontmatter.version ?? '0.0.0',
        dir: join(dir, entry.name),
        path,
        hash,
        status,
        bundled,
        source: 'user',
        body: parsed.body,
      });
    }
  }
  return [...byName.values()];
}

function truncateSkillBody(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars)}\n\n[skill truncated at ${maxChars} chars]`;
}

export class Skills {
  private skills = new Map<string, DiscoveredSkill>();
  private discovered: DiscoveredSkill[] = [];
  private projectDir: string;
  private bundledDir?: string;
  private consentFile: string;

  constructor(options: SkillsOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd());
    this.bundledDir = options.bundledDir;
    this.consentFile = options.consentPath ?? skillConsentPath();
  }

  refresh(): DiscoveredSkill[] {
    this.discovered = discoverSkills(this.projectDir, {
      bundledDir: this.bundledDir,
      consentPath: this.consentFile,
    });
    this.skills.clear();
    for (const skill of this.discovered) {
      if (skill.status === 'active') this.skills.set(skill.name, skill);
    }
    return this.discovered;
  }

  get(name: string): Skill | undefined {
    const skill = this.skills.get(name);
    if (!skill) return undefined;
    return {
      name: skill.name,
      description: skill.description,
      version: skill.version,
      state: 'active',
      source: skill.source,
      prompt: skill.body,
      hash: skill.hash,
    };
  }

  list(): SkillMetadata[] {
    return [...this.skills.values()].map(({ name, description, version, source }) => ({
      name,
      description,
      version,
      state: 'active' as const,
      source,
    }));
  }

  catalog(maxChars = SKILL_CATALOG_MAX_CHARS): string {
    const all = [...this.skills.values()];
    const lines: string[] = [];
    let used = 0;
    for (const skill of all) {
      const description =
        skill.description.length > DESCRIPTION_MAX_CHARS
          ? skill.description.slice(0, DESCRIPTION_MAX_CHARS - 1) + '…'
          : skill.description;
      const line = `${skill.name}: ${description}`;
      if (lines.length > 0 && used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    if (lines.length < all.length) lines.push(`(+${all.length - lines.length} more skills)`);
    return lines.join('\n');
  }

  load(name: string, maxChars = SKILL_BODY_MAX_CHARS): string {
    const skill = this.skills.get(name);
    if (!skill) {
      const stale = this.discovered.find((entry) => entry.name === name);
      const reason = !stale
        ? `skill "${name}" not found`
        : stale.status === 'pending'
          ? `skill "${name}" is pending approval`
          : `skill "${name}" changed on disk; re-approval required`;
      throw new LareError('SKILL_LOAD_FAILED', reason, { context: { skill: name } });
    }
    const content = readFileSync(skill.path, 'utf8');
    const hash = createHash('sha256').update(content).digest('hex');
    if (!skill.bundled && loadConsent(this.consentFile)[resolve(skill.path)] !== hash) {
      throw new LareError(
        'SKILL_LOAD_FAILED',
        `skill "${name}" changed on disk; re-approval required`,
        {
          context: { skill: name },
        }
      );
    }
    const parsed = parseSkillFile(content);
    return truncateSkillBody(parsed?.body ?? skill.body, maxChars);
  }

  approve(name: string): boolean {
    const skill = this.discovered.find((entry) => entry.name === name);
    if (!skill || skill.bundled) return false;
    consentToSkill(skill.path, this.consentFile);
    this.refresh();
    return this.skills.has(name);
  }
}
