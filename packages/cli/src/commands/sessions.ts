import { Shares } from '@larecode/server';
import {
  Sessions,
  redactSecrets,
  removeSessionCheckpoints,
  searchSessions,
  type SessionMetadata,
} from '@larecode/core';

function write(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function fail(message: string): number {
  process.stderr.write(`larecode: ${message}\n`);
  return 1;
}

function metadataLine(metadata: SessionMetadata): string {
  const title = metadata.title ?? metadata.id;
  const updated = metadata.updatedAt.toISOString().slice(0, 16).replace('T', ' ');
  return `${metadata.id}  ${updated}  ${metadata.messageCount} msg  ${metadata.tokenUsage} tok  ${title}`;
}

export function sessionsListCommand(options: { json?: boolean } = {}): number {
  const list = new Sessions().list();
  if (options.json) {
    write(JSON.stringify(list, null, 2));
    return 0;
  }
  if (list.length === 0) {
    write('no sessions');
    return 0;
  }
  for (const metadata of list) write(metadataLine(metadata));
  return 0;
}

export function sessionsShowCommand(id: string, options: { json?: boolean } = {}): number {
  const session = new Sessions().get(id);
  if (!session) return fail(`session "${id}" not found`);
  if (options.json) {
    write(JSON.stringify(session, null, 2));
    return 0;
  }
  write(`${session.metadata.title ?? session.id}`);
  write(`id: ${session.id}`);
  write(`updated: ${session.metadata.updatedAt.toISOString()}`);
  if (session.metadata.provider || session.metadata.model) {
    write(`model: ${session.metadata.provider ?? '?'}/${session.metadata.model ?? '?'}`);
  }
  write('');
  for (const message of session.messages) {
    write(`## ${message.role}`);
    write(redactSecrets(message.content));
    write('');
  }
  return 0;
}

export function sessionsSearchCommand(
  query: string,
  options: { json?: boolean; limit?: number } = {}
): number {
  const hits = searchSessions(query, { limit: options.limit });
  if (options.json) {
    write(JSON.stringify(hits, null, 2));
    return 0;
  }
  if (hits.length === 0) {
    write('no matches');
    return 0;
  }
  for (const hit of hits) {
    write(`${hit.sessionId}  ${hit.matches} match(es)  ${hit.snippet}`);
  }
  return 0;
}

export function sessionsExportCommand(id: string, options: { format?: string } = {}): number {
  const format = options.format === 'markdown' ? 'markdown' : 'json';
  const content = new Sessions().export(id, format);
  if (content === undefined) return fail(`session "${id}" not found`);
  write(content);
  return 0;
}

export function sessionsRewindCommand(id: string, count: string, yes = false): number {
  const sessions = new Sessions();
  const session = sessions.get(id);
  if (!session) return fail(`session "${id}" not found`);
  const target = Number.parseInt(count, 10);
  if (!Number.isInteger(target) || target < 0 || target > session.messages.length) {
    return fail(`message count must be between 0 and ${session.messages.length}`);
  }
  if (!yes && target < session.messages.length) {
    return fail(`refusing to drop ${session.messages.length - target} messages without --yes`);
  }
  sessions.rewind(id, target);
  write(`rewound ${id} to ${target} messages`);
  return 0;
}

export function sessionsPruneCommand(
  options: {
    olderThan?: string;
    keep?: string;
    json?: boolean;
  } = {}
): number {
  if (options.olderThan === undefined && options.keep === undefined) {
    return fail('specify --older-than <days> and/or --keep <count>');
  }
  const days = options.olderThan === undefined ? undefined : Number.parseInt(options.olderThan, 10);
  const keep = options.keep === undefined ? undefined : Number.parseInt(options.keep, 10);
  if (days !== undefined && (!Number.isFinite(days) || days < 0)) {
    return fail('--older-than must be a non-negative number of days');
  }
  if (keep !== undefined && (!Number.isFinite(keep) || keep < 0)) {
    return fail('--keep must be a non-negative number');
  }
  const removed = new Sessions().prune({ maxAgeDays: days, maxSessions: keep });
  if (options.json) {
    write(JSON.stringify({ removed }));
  } else {
    write(`removed ${removed} session(s)`);
  }
  return 0;
}

export function sessionsRmCommand(id: string): number {
  const sessions = new Sessions();
  if (!sessions.delete(id)) {
    process.stderr.write(`larecode: session "${id}" not found\n`);
    return 1;
  }
  const checkpoints = removeSessionCheckpoints(id);
  const shares = new Shares().removeForSession(id);
  process.stdout.write(
    `deleted session ${id} (${checkpoints} checkpoints, ${shares} share links)\n`
  );
  return 0;
}
