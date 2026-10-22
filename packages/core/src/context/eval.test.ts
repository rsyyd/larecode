import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from './context.js';
import { evaluateRetrieval } from './eval.js';

let root: string;

function file(path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'larecode-eval-'));
  file(
    'src/auth/session.ts',
    'export function createSession(token: string) {\n  return { token, expiresAt: Date.now() + 3600 };\n}\n'
  );
  file(
    'src/billing/invoice.ts',
    'export function invoiceTotal(lines) {\n  return lines.reduce((sum, line) => sum + line.amount, 0);\n}\n'
  );
  file(
    'src/http/router.ts',
    'export function routeRequest(path: string) {\n  return path.split("/").filter(Boolean);\n}\n'
  );
  file(
    'src/db/migrate.ts',
    'export async function migrate(database) {\n  await database.run("create table sessions");\n}\n'
  );
  file('README.md', '# Demo\n\nA small service with sessions, invoices, routes, and migrations.\n');
  file('package.json', '{"name":"demo","scripts":{"test":"vitest"}}');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('retrieval eval harness', () => {
  it('meets the recall threshold on the fixture repo', async () => {
    const context = new Context();
    await context.index(root);
    const report = evaluateRetrieval(context, [
      { query: 'session token expiry', expected: 'src/auth/session.ts' },
      { query: 'invoice total amount', expected: 'src/billing/invoice.ts' },
      { query: 'request route path', expected: 'src/http/router.ts' },
      { query: 'database migration sessions table', expected: 'src/db/migrate.ts' },
      { query: 'test scripts package', expected: 'package.json' },
    ]);

    expect(report.total).toBe(5);
    expect(report.recall).toBeGreaterThanOrEqual(0.8);
    expect(report.results[0]).toMatchObject({
      found: true,
      expected: 'src/auth/session.ts',
    });
  });

  it('reports misses with the files it ranked instead', async () => {
    const context = new Context();
    await context.index(root);
    const report = evaluateRetrieval(context, [
      { query: 'zzzz nonsense token', expected: 'src/missing.ts' },
    ]);
    expect(report).toMatchObject({ total: 1, hits: 0, recall: 0 });
    expect(report.results[0].found).toBe(false);
    expect(report.results[0].files.length).toBeLessThanOrEqual(3);
  });
});
