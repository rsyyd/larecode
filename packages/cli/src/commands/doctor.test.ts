import { describe, expect, it, vi } from 'vitest';
import type { LareCodeFetch, ProviderConfig } from '@larecode/core';
import { providerChecks, suggestionFor } from './doctor.js';

function okJson(data: unknown): Response {
  return { ok: true, json: async () => data } as unknown as Response;
}

function rawStream(body: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

const provider: ProviderConfig = {
  type: 'openai-compatible',
  baseUrl: 'https://mock.example/v1',
  apiKey: 'secret',
  models: ['mock-model'],
};

describe('doctor provider checks', () => {
  it('checks auth, reachability, model, and streaming against a mock provider', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST') {
        return rawStream('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
      }
      return okJson({ data: [{ id: 'mock-model' }] });
    }) as LareCodeFetch;

    const checks = await providerChecks('mock', provider, 'mock-model', {
      fetchImpl,
      timeoutMs: 200,
    });

    expect(checks).toEqual([
      { label: 'auth', ok: true, detail: 'key configured' },
      { label: 'reachability', ok: true, detail: 'https://mock.example/v1' },
      { label: 'model', ok: true, detail: 'mock-model' },
      { label: 'streaming', ok: true, detail: 'ok' },
    ]);
    expect(calls).toEqual([
      'GET https://mock.example/',
      'GET https://mock.example/v1/models',
      'POST https://mock.example/v1/chat/completions',
    ]);
  });

  it('stops before network calls when auth is missing', async () => {
    const fetchImpl = vi.fn();
    const checks = await providerChecks('mock', { ...provider, apiKey: undefined }, 'mock-model', {
      fetchImpl: fetchImpl as unknown as LareCodeFetch,
    });

    expect(checks).toEqual([{ label: 'auth', ok: false, detail: 'no API key configured' }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a failed model and streaming check', async () => {
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return { ok: false, status: 401 } as unknown as Response;
      }
      return okJson({ data: [{ id: 'other-model' }] });
    }) as LareCodeFetch;

    const checks = await providerChecks('mock', provider, 'mock-model', {
      fetchImpl,
      timeoutMs: 200,
    });

    expect(checks.find((check) => check.label === 'model')).toMatchObject({ ok: false });
    expect(checks.find((check) => check.label === 'streaming')).toMatchObject({
      ok: false,
      detail: expect.stringContaining('401'),
    });
  });

  it('suggests actionable fixes for common problems', () => {
    expect(suggestionFor('provider "x" model "y": auth — no API key configured')).toContain(
      'larecode setup'
    );
    expect(suggestionFor('provider "x": model — zz is not in the provider catalog')).toContain(
      'provider models list'
    );
    expect(suggestionFor('home directory /x is not writable')).toContain('LARECODE_HOME');
    expect(suggestionFor('something unknown')).toContain('larecode doctor');
  });
});
