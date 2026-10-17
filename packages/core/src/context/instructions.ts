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
