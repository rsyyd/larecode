import { auditPath, readAuditLog, verifyAuditLog } from '@larecode/core';

export function auditVerifyCommand(options: { json?: boolean } = {}): number {
  const result = verifyAuditLog(auditPath());
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  }
  process.stdout.write(
    result.ok
      ? `audit chain ok (${result.entries} entries)\n`
      : `audit chain broken at entry #${result.brokenAt}: ${result.reason}\n`
  );
  return result.ok ? 0 : 1;
}

export function auditLogCommand(options: { limit?: number; json?: boolean } = {}): number {
  const entries = readAuditLog(auditPath());
  const limited = options.limit ? entries.slice(-options.limit) : entries;
  process.stdout.write(entries.length === 0 ? 'no audit entries yet\n' : '');
  for (const entry of limited) {
    process.stdout.write(
      options.json
        ? `${JSON.stringify(entry)}\n`
        : `#${entry.seq} ${new Date(entry.timestamp).toISOString()} ${entry.group} ${entry.allowed ? 'allowed' : 'denied'} (${entry.source ?? '?'})\n`
    );
  }
  const dropped = entries.length - limited.length;
  if (dropped > 0 && !options.json) process.stdout.write(`... ${dropped} older entries omitted\n`);
  return 0;
}
