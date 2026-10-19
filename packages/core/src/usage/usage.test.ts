import { describe, it, expect } from 'vitest';
import {
  createUsageRecorder,
  estimateCost,
  estimateTokens,
  formatCost,
  formatTokens,
  DEFAULT_MODEL_PRICING,
  type TokenUsage,
  type CostUsage,
} from './usage.js';

describe('Usage accounting', () => {
  const sampleTokens: TokenUsage = { input: 100, output: 50, total: 150 };
  const sampleCost: CostUsage = { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003 };

  it('records and aggregates usage per conversation', () => {
    const r = createUsageRecorder('conv-1');
    r.record(sampleTokens, sampleCost, 'gpt-4o', 'openai');
    r.record(
      { input: 200, output: 100, total: 300 },
      { inputCost: 0.002, outputCost: 0.004, totalCost: 0.006 },
      'gpt-4o',
      'openai'
    );

    const agg = r.getAggregate();
    expect(agg.totalTokens.input).toBe(300);
    expect(agg.totalTokens.output).toBe(150);
    expect(agg.totalTokens.total).toBe(450);
    expect(agg.totalCost.totalCost).toBeCloseTo(0.009);
    expect(agg.byModel['openai:gpt-4o'].totalTokens.total).toBe(450);
  });

  it('tracks different models separately', () => {
    const r = createUsageRecorder('conv-2');
    r.record(
      { input: 10, output: 5, total: 15 },
      { inputCost: 0.0001, outputCost: 0.0002, totalCost: 0.0003 },
      'gpt-4o',
      'openai'
    );
    r.record(
      { input: 5, output: 3, total: 8 },
      { inputCost: 0.00005, outputCost: 0.0001, totalCost: 0.00015 },
      'claude-3-5-sonnet',
      'anthropic'
    );

    const agg = r.getAggregate();
    expect(Object.keys(agg.byModel).length).toBe(2);
    expect(agg.byModel['openai:gpt-4o'].totalTokens.total).toBe(15);
    expect(agg.byModel['anthropic:claude-3-5-sonnet'].totalTokens.total).toBe(8);
  });

  it('getSnapshot returns last recorded entry', () => {
    const r = createUsageRecorder('conv-3');
    r.record(
      { input: 1, output: 1, total: 2 },
      { inputCost: 0, outputCost: 0, totalCost: 0 },
      'm1',
      'p1'
    );
    r.record(
      { input: 10, output: 10, total: 20 },
      { inputCost: 0, outputCost: 0, totalCost: 0 },
      'm2',
      'p2'
    );
    const snap = r.getSnapshot();
    expect(snap.model).toBe('m2');
    expect(snap.provider).toBe('p2');
  });

  it('reset clears all data but keeps conversationId', () => {
    const r = createUsageRecorder('conv-4');
    r.record(
      { input: 100, output: 100, total: 200 },
      { inputCost: 1, outputCost: 1, totalCost: 2 },
      'gpt-4o',
      'openai'
    );
    r.reset();
    const agg = r.getAggregate();
    expect(agg.totalTokens.total).toBe(0);
    expect(agg.totalCost.totalCost).toBe(0);
    expect(agg.conversationId).toBe('conv-4');
  });

  it('estimateCost computes cost from pricing table', () => {
    const tokens: TokenUsage = { input: 1000, output: 500, total: 1500 };
    const cost = estimateCost(tokens, 'gpt-4o', DEFAULT_MODEL_PRICING);
    expect(cost.inputCost).toBeCloseTo(0.005); // 1000/1000 * 0.005
    expect(cost.outputCost).toBeCloseTo(0.0075); // 500/1000 * 0.015
    expect(cost.totalCost).toBeCloseTo(0.0125);
  });

  it('estimateCost returns zero for unknown model', () => {
    const cost = estimateCost(
      { input: 100, output: 100, total: 200 },
      'unknown-model',
      DEFAULT_MODEL_PRICING
    );
    expect(cost.totalCost).toBe(0);
  });

  it('estimateTokens rounds up to whole tokens', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('Hello world!')).toBe(3);
  });

  it('accumulates cache-read tokens when reported', () => {
    const r = createUsageRecorder('conv-cache');
    r.record(
      { input: 100, output: 50, total: 150, cacheRead: 80 },
      { inputCost: 0, outputCost: 0, totalCost: 0 },
      'gpt-4o',
      'openai'
    );
    r.record(
      { input: 100, output: 50, total: 150 },
      { inputCost: 0, outputCost: 0, totalCost: 0 },
      'gpt-4o',
      'openai'
    );

    const agg = r.getAggregate();
    expect(agg.totalTokens.cacheRead).toBe(80);
    expect(agg.byModel['openai:gpt-4o'].totalTokens.cacheRead).toBe(80);
  });

  it('formats tokens and cost for the footer', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1200)).toBe('1.2k');
    expect(formatTokens(12500)).toBe('12.5k');
    expect(formatCost(0.006)).toBe('$0.0060');
    expect(formatCost(0)).toBe('$0.0000');
  });
});
