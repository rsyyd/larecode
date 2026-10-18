import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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
