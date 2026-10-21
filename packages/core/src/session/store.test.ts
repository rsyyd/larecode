import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSessionStore, MemorySessionStore, type SessionStore } from './store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lare-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const implementations: Array<[string, () => SessionStore, boolean]> = [
  ['file', () => new FileSessionStore(join(dir, 'sessions')), true],
  ['memory', () => new MemorySessionStore(), false],
];

for (const [name, make, persists] of implementations) {
  describe(`${name} session store`, () => {
    it('creates, saves, lists, and deletes sessions', async () => {
      const store = make();
      const session = await store.create('hello');
      expect(session.metadata.messageCount).toBe(1);
      expect(await store.get(session.id)).toBe(session);

      session.messages.push({ role: 'assistant', content: 'hi', timestamp: new Date() });
      await store.save(session);
      expect((await store.get(session.id))?.metadata.messageCount).toBe(2);
      expect((await store.list()).map((entry) => entry.id)).toEqual([session.id]);

      expect(await store.delete(session.id)).toBe(true);
      expect(await store.get(session.id)).toBeUndefined();
      expect(await store.delete(session.id)).toBe(false);
    });

    it(persists ? 'reloads sessions from disk' : 'keeps sessions in memory only', async () => {
      const store = make();
      const session = await store.create('hello');
      const loaded = await make().get(session.id);
      if (persists) {
        expect(loaded?.messages[0]?.content).toBe('hello');
      } else {
        expect(loaded).toBeUndefined();
      }
    });
  });
}
