import { describe, expect, it } from 'vitest';
import { Metrics } from './metrics.js';

describe('Metrics', () => {
  it('counts turns, retries, tool and provider activity', () => {
    const metrics = new Metrics();
    metrics.recordTurn();
    metrics.recordTurn();
    metrics.recordRetry();
    metrics.recordTool('read', 10, true);
    metrics.recordTool('read', 30, false);
    metrics.recordTool('bash', 5, true);
    metrics.recordProvider('9router', 100, true);

    const snapshot = metrics.snapshot();
    expect(snapshot.turns).toBe(2);
    expect(snapshot.retries).toBe(1);
    expect(snapshot.tools).toMatchObject({ calls: 3, errors: 1, totalMs: 45 });
    expect(snapshot.tools.byName.read).toMatchObject({ calls: 2, errors: 1, totalMs: 40 });
    expect(snapshot.providers.byName['9router']).toMatchObject({
      calls: 1,
      errors: 0,
      totalMs: 100,
    });
  });

  it('resets counters', () => {
    const metrics = new Metrics();
    metrics.recordTurn();
    metrics.reset();
    expect(metrics.snapshot().turns).toBe(0);
    expect(metrics.snapshot().tools.calls).toBe(0);
  });
});
