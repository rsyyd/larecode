import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lumpscodeHome } from '../config/config.js';
import { redactValue } from '../permission/redact.js';
import type { SessionMessage } from '../session/session.js';
import { estimateTokens } from '../usage/usage.js';

export type MemoryTier = 'temporary' | 'session' | 'project' | 'user';

export interface MemoryEntry {
  tier: MemoryTier;
  key: string;
  value: unknown;
  createdAt: Date;
  expiresAt?: Date;
}

export interface MemoryFact {
  key: string;
  value: unknown;
}

export interface MemoryOptions {
  dir?: string;
  projectDir?: string;
}

export interface RetrieveOptions {
  tiers?: MemoryTier[];
  budgetTokens?: number;
}

export const MEMORY_BUDGET_TOKENS = 400;
export const MAX_EXTRACTED_FACTS = 20;
export const MAX_TRANSCRIPT_CHARS = 20_000;

const DEFAULT_TIERS: MemoryTier[] = ['temporary', 'session', 'project', 'user'];
const PERSISTED_TIERS: MemoryTier[] = ['project', 'user'];
const TIER_LIMITS: Record<MemoryTier, number> = {
  temporary: 1000,
  session: 5000,
  project: 10000,
  user: 50000,
};
const TERM_RE = /[a-z0-9_]{3,}/g;

export function memoryDir(): string {
  return join(lumpscodeHome(), 'memory');
}

export function renderEntry(entry: MemoryEntry): string {
  const value = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
  return `${entry.key}: ${value}`;
}

export function renderEntries(entries: MemoryEntry[]): string {
  return entries.map(renderEntry).join('\n');
}

interface StoredEntry {
  key: string;
  value: unknown;
  createdAt: string;
  expiresAt?: string;
}

export class Memory {
  private stores = new Map<MemoryTier, Map<string, MemoryEntry>>();
  private readonly dir: string;
  private readonly files = new Map<MemoryTier, string>();

  constructor(options: MemoryOptions = {}) {
    this.dir = options.dir ?? memoryDir();
    for (const tier of DEFAULT_TIERS) this.stores.set(tier, new Map());
    for (const tier of PERSISTED_TIERS) {
      this.files.set(tier, join(this.dir, this.fileName(tier, options.projectDir)));
      this.load(tier);
    }
  }

  private fileName(tier: MemoryTier, projectDir?: string): string {
    if (tier === 'user') return 'user.json';
    const scope = createHash('sha256')
      .update(projectDir ?? process.cwd())
      .digest('hex')
      .slice(0, 16);
    return `project-${scope}.json`;
  }

  private load(tier: MemoryTier): void {
    const file = this.files.get(tier);
    if (!file || !existsSync(file)) return;
    let stored: { entries?: StoredEntry[] };
    try {
      stored = JSON.parse(readFileSync(file, 'utf8')) as { entries?: StoredEntry[] };
    } catch {
      return;
    }
    const store = this.stores.get(tier)!;
    const now = Date.now();
    for (const entry of stored.entries ?? []) {
      if (entry.expiresAt && Date.parse(entry.expiresAt) <= now) continue;
      store.set(entry.key, {
        tier,
        key: entry.key,
        value: entry.value,
        createdAt: new Date(entry.createdAt),
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : undefined,
      });
    }
  }

  private persist(tier: MemoryTier): void {
    const file = this.files.get(tier);
    if (!file) return;
    mkdirSync(this.dir, { recursive: true });
    const entries: StoredEntry[] = [...this.stores.get(tier)!.values()].map((entry) => ({
      key: entry.key,
      value: redactValue(entry.value),
      createdAt: entry.createdAt.toISOString(),
      expiresAt: entry.expiresAt?.toISOString(),
    }));
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ entries }, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, file);
  }

  private evictExpired(tier: MemoryTier): void {
    const store = this.stores.get(tier)!;
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt && entry.expiresAt.getTime() <= now) store.delete(key);
    }
  }

  remember(tier: MemoryTier, key: string, value: unknown, options: { ttlMs?: number } = {}) {
    const store = this.stores.get(tier)!;
    this.evictExpired(tier);
    if (!store.has(key) && store.size >= TIER_LIMITS[tier]) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    const entry: MemoryEntry = {
      tier,
      key,
      value,
      createdAt: new Date(),
      expiresAt: options.ttlMs ? new Date(Date.now() + options.ttlMs) : undefined,
    };
    store.set(key, entry);
    this.persist(tier);
    return entry;
  }

  rememberFacts(tier: MemoryTier, facts: MemoryFact[]): MemoryEntry[] {
    return facts.map((fact) => this.remember(tier, fact.key, fact.value));
  }

  get(tier: MemoryTier, key: string): MemoryEntry | undefined {
    const entry = this.stores.get(tier)!.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt.getTime() <= Date.now()) {
      this.stores.get(tier)!.delete(key);
      this.persist(tier);
      return undefined;
    }
    return entry;
  }

  forget(tier: MemoryTier, key: string): boolean {
    const removed = this.stores.get(tier)!.delete(key);
    if (removed) this.persist(tier);
    return removed;
  }

  clear(tier: MemoryTier): void {
    this.stores.get(tier)!.clear();
    this.persist(tier);
  }

  entries(tier: MemoryTier): MemoryEntry[] {
    this.evictExpired(tier);
    return [...this.stores.get(tier)!.values()];
  }

  retrieve(query: string, options: RetrieveOptions = {}): MemoryEntry[] {
    const terms = [...new Set(query.toLowerCase().match(TERM_RE) ?? [])];
    if (terms.length === 0) return [];
    const budget = options.budgetTokens ?? MEMORY_BUDGET_TOKENS;
    const scored: Array<{ entry: MemoryEntry; score: number }> = [];
    for (const tier of options.tiers ?? DEFAULT_TIERS) {
      for (const entry of this.entries(tier)) {
        const key = entry.key.toLowerCase();
        const text = (
          typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)
        ).toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (key.includes(term)) score += 2;
          else if (text.includes(term)) score += 1;
        }
        if (score > 0) scored.push({ entry, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const picked: MemoryEntry[] = [];
    let used = 0;
    for (const { entry } of scored) {
      const cost = estimateTokens(renderEntry(entry)) + 1;
      if (picked.length > 0 && used + cost > budget) break;
      picked.push(entry);
      used += cost;
    }
    return picked;
  }
}

export async function extractFacts(
  messages: SessionMessage[],
  extract: (transcript: string) => Promise<MemoryFact[]>
): Promise<MemoryFact[]> {
  const transcript = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n')
    .slice(-MAX_TRANSCRIPT_CHARS);
  if (transcript.trim() === '') return [];
  const raw = await extract(transcript);
  const facts = new Map<string, MemoryFact>();
  for (const fact of raw ?? []) {
    const key = typeof fact?.key === 'string' ? fact.key.trim() : '';
    if (!key || fact.value === undefined) continue;
    facts.set(key, { key, value: fact.value });
  }
  return [...facts.values()].slice(0, MAX_EXTRACTED_FACTS);
}
