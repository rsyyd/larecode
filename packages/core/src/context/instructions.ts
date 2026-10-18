import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { lumpscodeHome } from '../config/config.js';

export type InstructionStatus = 'consented' | 'pending' | 'changed';

export interface InstructionFile {
  file: string;
  relative: string;
  hash: string;
  status: InstructionStatus;
}

export const INSTRUCTION_FILES = [
  'AGENTS.md',
  'LUMPCODE.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
] as const;

export function consentPath(): string {
  return join(lumpscodeHome(), 'consent.json');
}

export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function loadConsent(): Record<string, string> {
  const path = consentPath();
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : {};
}

export function consentToFile(path: string): void {
  const consent = loadConsent();
  consent[resolve(path)] = hashFile(path);
  mkdirSync(dirname(consentPath()), { recursive: true });
  writeFileSync(consentPath(), JSON.stringify(consent, null, 2) + '\n', { mode: 0o600 });
  chmodSync(consentPath(), 0o600);
}

export function discoverInstructions(projectDir: string): InstructionFile[] {
  const consent = loadConsent();
  const results: InstructionFile[] = [];
  for (const relative of INSTRUCTION_FILES) {
    const file = resolve(projectDir, relative);
    if (!existsSync(file)) continue;
    const hash = hashFile(file);
    const known = consent[file];
    const status: InstructionStatus =
      known === undefined ? 'pending' : known === hash ? 'consented' : 'changed';
    results.push({ file, relative, hash, status });
  }
  return results;
}

export const INSTRUCTION_BUDGET_CHARS = 32000;

export interface InstructionContextOptions {
  maxChars?: number;
}

export function loadInstructionContext(
  projectDir: string,
  options: InstructionContextOptions = {}
): string {
  const budget = options.maxChars ?? INSTRUCTION_BUDGET_CHARS;
  const parts: string[] = [];
  let used = 0;
  for (const instruction of discoverInstructions(projectDir)) {
    if (instruction.status !== 'consented') continue;
    let content: string;
    try {
      content = readFileSync(instruction.file, 'utf8');
    } catch {
      continue;
    }
    const header = `# ${instruction.relative}\n`;
    const separator = parts.length > 0 ? 2 : 0;
    const remaining = budget - used - separator - header.length;
    if (remaining <= 0) {
      parts.push(`[instructions truncated: budget of ${budget} chars reached]`);
      break;
    }
    const piece =
      content.length > remaining ? `${content.slice(0, remaining)}\n[truncated]` : content;
    parts.push(header + piece);
    used += separator + header.length + piece.length;
  }
  return parts.join('\n\n');
}
