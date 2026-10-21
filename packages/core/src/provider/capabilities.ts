import type { ProviderCapabilities } from './provider.js';

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  'openai-compatible': {
    tools: true,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
    contextWindow: 128000,
  },
  custom: {
    tools: true,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
    contextWindow: 128000,
  },
  openrouter: {
    tools: true,
    vision: true,
    reasoning: true,
    streaming: true,
    maxTokens: 4096,
    contextWindow: 200000,
  },
  zai: {
    tools: true,
    vision: true,
    reasoning: true,
    streaming: true,
    maxTokens: 4096,
    contextWindow: 200000,
  },
  anthropic: {
    tools: true,
    vision: true,
    reasoning: true,
    streaming: true,
    maxTokens: 8192,
    contextWindow: 200000,
  },
  ollama: {
    tools: true,
    vision: false,
    reasoning: false,
    streaming: true,
    maxTokens: 4096,
    contextWindow: 8192,
  },
};

export function capabilitiesFor(type: string): ProviderCapabilities {
  return { ...(PROVIDER_CAPABILITIES[type] ?? PROVIDER_CAPABILITIES['openai-compatible']) };
}

export function modelCapabilities(base: ProviderCapabilities, id: string): ProviderCapabilities {
  const s = id.toLowerCase();
  return {
    ...base,
    vision: base.vision || /(vision|llava|-vl\b|gpt-4o|claude|gemini|internvl)/.test(s),
    reasoning: base.reasoning || /(thinking|reasoning|o[1-9][^a-z]|\br1\b|glm-4\.[5-9])/.test(s),
  };
}
