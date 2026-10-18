const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{10,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi;

const KEY_VALUE_PATTERN =
  /\b(password|passwd|secret|token|api[-_]?key|apikey|authorization|credential|access[-_]?key)(\s*[:=]\s*|\s+)([^\s'"]{6,})/gi;

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  redacted = redacted.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
  redacted = redacted.replace(KEY_VALUE_PATTERN, (_match, key: string, separator: string) => {
    return `${key}${separator}${REDACTED}`;
  });
  return redacted;
}

export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = redactValue(item, seen);
  }
  return out;
}
