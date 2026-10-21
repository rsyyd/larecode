import { arch, cpus, platform, release, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { larecodeHome, loadEffectiveConfig } from '../config/config.js';
import { defaultMetrics, type MetricsSnapshot } from '../metrics/metrics.js';
import { redactSecrets, redactValue } from '../permission/redact.js';
import { Sessions, type SessionMetadata } from '../session/session.js';
import { formatCost, formatTokens } from '../usage/usage.js';
import { VERSION } from '../version.js';

export interface UsageSummary {
  sessions: number;
  messages: number;
  tokens: number;
  cost: number;
  byModel: Record<string, { sessions: number; tokens: number; cost: number }>;
}

export function summarizeUsage(sessions: SessionMetadata[]): UsageSummary {
  const summary: UsageSummary = { sessions: 0, messages: 0, tokens: 0, cost: 0, byModel: {} };
  for (const session of sessions) {
    summary.sessions += 1;
    summary.messages += session.messageCount;
    summary.tokens += session.tokenUsage;
    summary.cost += session.cost;
    const key = `${session.provider ?? 'unknown'}/${session.model ?? 'unknown'}`;
    const bucket = (summary.byModel[key] ??= { sessions: 0, tokens: 0, cost: 0 });
    bucket.sessions += 1;
    bucket.tokens += session.tokenUsage;
    bucket.cost += session.cost;
  }
  return summary;
}

export function formatUsage(summary: UsageSummary): string {
  const lines = [
    `sessions: ${summary.sessions}`,
    `messages: ${summary.messages}`,
    `tokens: ${formatTokens(summary.tokens)}`,
    `cost: ${formatCost(summary.cost)}`,
  ];
  const models = Object.entries(summary.byModel).sort((a, b) => b[1].tokens - a[1].tokens);
  for (const [model, bucket] of models) {
    lines.push(
      `  ${model}: ${formatTokens(bucket.tokens)} tokens, ${formatCost(bucket.cost)}, ${bucket.sessions} sessions`
    );
  }
  return lines.join('\n');
}

export function environmentSummary(): Record<string, unknown> {
  return {
    version: VERSION,
    platform: platform(),
    arch: arch(),
    release: release(),
    cpus: cpus().length,
    memoryMb: Math.round(totalmem() / 1024 / 1024),
    runtime: process.version,
  };
}

export interface DebugBundle {
  generatedAt: string;
  environment: Record<string, unknown>;
  config: unknown;
  metrics: MetricsSnapshot;
  sessions: UsageSummary;
}

export function createDebugBundle(
  sessions: SessionMetadata[] = new Sessions().list()
): DebugBundle {
  return {
    generatedAt: new Date().toISOString(),
    environment: environmentSummary(),
    config: redactValue(loadEffectiveConfig()),
    metrics: defaultMetrics.snapshot(),
    sessions: summarizeUsage(sessions),
  };
}

export function writeDebugBundle(dir: string = join(larecodeHome(), 'debug')): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `bundle-${Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(createDebugBundle(), null, 2)}\n`, { mode: 0o600 });
  return path;
}

export function writeCrashReport(
  error: unknown,
  dir: string = join(larecodeHome(), 'crashes')
): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `crash-${Date.now()}.json`);
  const detail =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        environment: environmentSummary(),
        error: redactValue(detail),
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  return path;
}

export function installCrashReporter(): void {
  process.on('uncaughtException', (error) => {
    const path = writeCrashReport(error);
    process.stderr.write(`larecode crashed: ${error.message}\nreport: ${path}\n`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const path = writeCrashReport(reason);
    process.stderr.write(`larecode unhandled rejection: ${String(reason)}\nreport: ${path}\n`);
    process.exitCode = 1;
  });
}

export function writeFeedback(
  text: string,
  dir: string = join(larecodeHome(), 'feedback')
): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `feedback-${Date.now()}.md`);
  const body = [
    '# larecode feedback',
    '',
    redactSecrets(text),
    '',
    '## environment',
    '',
    '```json',
    JSON.stringify(environmentSummary(), null, 2),
    '```',
    '',
  ].join('\n');
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}
