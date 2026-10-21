import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { larecodeHome } from '../config/config.js';
import type { PermissionGroup } from './permission.js';
import { redactSecrets } from './redact.js';

export interface AuditEntry {
  timestamp: number;
  group: PermissionGroup;
  allowed: boolean;
  requiresConfirmation: boolean;
  unattended: boolean;
  confirmedByUser: boolean;
  source?: string;
  reason?: string;
}

export type AuditSink = (entry: AuditEntry) => void;

export type AuditInput = Omit<AuditEntry, 'timestamp'>;

export interface ChainedAuditLine extends AuditEntry {
  seq: number;
  prev: string;
  hash: string;
}

export interface AuditVerifyResult {
  ok: boolean;
  entries: number;
  brokenAt?: number;
  reason?: string;
}

export function auditPath(): string {
  return join(larecodeHome(), 'audit.log');
}

export class AuditLog {
  readonly entries: AuditEntry[] = [];
  private readonly sinks: AuditSink[];

  constructor(sinks: AuditSink[] = []) {
    this.sinks = [...sinks];
  }

  onRecord(sink: AuditSink): void {
    this.sinks.push(sink);
  }

  record(input: AuditInput): AuditEntry {
    const entry: AuditEntry = {
      timestamp: Date.now(),
      ...input,
      source: input.source === undefined ? undefined : redactSecrets(input.source),
      reason: input.reason === undefined ? undefined : redactSecrets(input.reason),
    };
    this.entries.push(entry);
    for (const sink of this.sinks) {
      try {
        sink(entry);
      } catch {
        // sink failures never break permission checks
      }
    }
    return entry;
  }
}

export function fileAuditSink(path: string): AuditSink {
  let directoryReady = false;
  return (entry) => {
    if (!directoryReady) {
      mkdirSync(dirname(path), { recursive: true });
      directoryReady = true;
    }
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
  };
}

export function hashChainAuditSink(path: string): AuditSink {
  let seq = 0;
  let prev = '';
  if (existsSync(path)) {
    const lines = readLines(path);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const last = JSON.parse(lines[index]) as ChainedAuditLine;
        seq = last.seq;
        prev = last.hash;
        break;
      } catch {
        continue;
      }
    }
  }
  let directoryReady = false;
  return (entry) => {
    if (!directoryReady) {
      mkdirSync(dirname(path), { recursive: true });
      directoryReady = true;
    }
    seq += 1;
    const payload = { ...entry, seq, prev };
    const hash = createHash('sha256')
      .update(`${prev}|${JSON.stringify(payload)}`)
      .digest('hex');
    appendFileSync(path, `${JSON.stringify({ ...payload, hash })}\n`);
    prev = hash;
  };
}

export function readAuditLog(path: string = auditPath()): ChainedAuditLine[] {
  if (!existsSync(path)) return [];
  const entries: ChainedAuditLine[] = [];
  for (const line of readLines(path)) {
    try {
      entries.push(JSON.parse(line) as ChainedAuditLine);
    } catch {
      continue;
    }
  }
  return entries;
}

export function verifyAuditLog(path: string = auditPath()): AuditVerifyResult {
  if (!existsSync(path)) return { ok: true, entries: 0 };
  const entries: ChainedAuditLine[] = [];
  for (const line of readLines(path)) {
    try {
      entries.push(JSON.parse(line) as ChainedAuditLine);
    } catch {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: entries.length + 1,
        reason: 'corrupt entry',
      };
    }
  }
  let prev = '';
  for (const entry of entries) {
    const { hash, ...payload } = entry;
    if (payload.prev !== prev) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: entry.seq,
        reason: 'hash chain broken',
      };
    }
    const expected = createHash('sha256')
      .update(`${prev}|${JSON.stringify(payload)}`)
      .digest('hex');
    if (expected !== hash) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: entry.seq,
        reason: 'entry tampered',
      };
    }
    prev = hash;
  }
  return { ok: true, entries: entries.length };
}

function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}
