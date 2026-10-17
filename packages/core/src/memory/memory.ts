export type MemoryTier = "temporary" | "session" | "project" | "user";

export interface MemoryEntry {
  id: string;
  tier: MemoryTier;
  key: string;
  value: unknown;
  createdAt: Date;
  expiresAt?: Date;
  redacted?: boolean;
}

export class Memory {
  private stores = new Map<MemoryTier, Map<string, MemoryEntry>>();
  private maxSizes = new Map<MemoryTier, number>([
    ["temporary", 1000],
    ["session", 5000],
    ["project", 10000],
    ["user", 50000],
  ]);

  constructor() {
    for (const tier of ["temporary", "session", "project", "user"] as MemoryTier[]) {
      this.stores.set(tier, new Map());
    }
  }

  set(tier: MemoryTier, key: string, value: unknown, ttlMs?: number): void {
    const store = this.stores.get(tier)!;
    if (store.size >= (this.maxSizes.get(tier) || 10000)) {
      const firstKey = store.keys().next().value;
      if (firstKey !== undefined) store.delete(firstKey);
    }
    store.set(key, {
      id: crypto.randomUUID(),
      tier,
      key,
      value,
      createdAt: new Date(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs) : undefined,
    });
  }

  get(tier: MemoryTier, key: string): MemoryEntry | undefined {
    const entry = this.stores.get(tier)?.get(key);
    if (entry?.expiresAt && entry.expiresAt < new Date()) {
      this.stores.get(tier)?.delete(key);
      return undefined;
    }
    return entry;
  }

  delete(tier: MemoryTier, key: string): boolean {
    return this.stores.get(tier)?.delete(key) ?? false;
  }

  clear(tier: MemoryTier): void {
    this.stores.get(tier)?.clear();
  }

  search(
    query: string,
    tiers: MemoryTier[] = ["temporary", "session", "project", "user"]
  ): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    for (const tier of tiers) {
      for (const entry of this.stores.get(tier)!.values()) {
        if (JSON.stringify(entry.value).includes(query)) {
          results.push(entry);
        }
      }
    }
    return results;
  }
}