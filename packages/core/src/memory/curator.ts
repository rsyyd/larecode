import type { SessionMessage } from '../session/session.js';
import { Memory, extractFacts, type MemoryEntry, type MemoryFact } from './memory.js';

export const CURATE_EVERY_TURNS = 6;

export interface CuratorOptions {
  memory: Memory;
  extract: (transcript: string) => Promise<MemoryFact[]>;
  everyTurns?: number;
  tier?: 'project' | 'user';
}

function sameValue(entry: MemoryEntry | undefined, value: unknown): boolean {
  if (!entry) return false;
  return JSON.stringify(entry.value) === JSON.stringify(value);
}

export class MemoryCurator {
  private readonly memory: Memory;
  private readonly extract: CuratorOptions['extract'];
  private readonly everyTurns: number;
  private readonly tier: 'project' | 'user';

  constructor(options: CuratorOptions) {
    this.memory = options.memory;
    this.extract = options.extract;
    this.everyTurns = Math.max(1, options.everyTurns ?? CURATE_EVERY_TURNS);
    this.tier = options.tier ?? 'project';
  }

  due(turnCount: number): boolean {
    return turnCount > 0 && turnCount % this.everyTurns === 0;
  }

  async curate(messages: SessionMessage[]): Promise<MemoryEntry[]> {
    const facts = await extractFacts(messages, this.extract);
    const fresh = facts.filter(
      (fact) => !sameValue(this.memory.get(this.tier, fact.key), fact.value)
    );
    if (fresh.length === 0) return [];
    return this.memory.rememberFacts(this.tier, fresh);
  }

  async maybeCurate(turnCount: number, messages: SessionMessage[]): Promise<MemoryEntry[]> {
    if (!this.due(turnCount)) return [];
    return this.curate(messages);
  }
}
