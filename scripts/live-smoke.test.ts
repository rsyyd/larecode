import { describe, expect, it } from 'vitest';
import { OpenAIAdapter } from '../packages/core/src/index.js';

const baseUrl = process.env.LARECODE_LIVE_BASE_URL ?? '';
const apiKey = process.env.LARECODE_LIVE_API_KEY ?? '';
const model = process.env.LARECODE_LIVE_MODEL ?? '';
const enabled =
  process.env.LARECODE_LIVE_SMOKE === '1' && baseUrl !== '' && apiKey !== '' && model !== '';

describe.skipIf(!enabled)('live provider smoke', () => {
  it('completes a real request', async () => {
    const adapter = new OpenAIAdapter({
      name: 'live',
      baseUrl,
      apiKey,
      models: [model],
    });
    const text = await adapter.complete('Reply with exactly: OK', {
      model,
      systemPrompt: 'You are a smoke test. Reply with exactly OK.',
    });
    expect(text.trim().toLowerCase()).toContain('ok');
  }, 30_000);
});
