---
title: Providers
nav_order: 3
description: OpenAI-compatible, Anthropic, Ollama, OpenRouter, and custom providers
---

# Providers

Lare Code is provider-neutral. Every provider entry has a type, a base URL, and a model list.

```json
{
  "providers": {
    "openai-compatible": {
      "type": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "models": ["gpt-4o", "gpt-4o-mini"]
    }
  }
}
```

## Supported types

| Type                | Streams | Notes                                                        |
| ------------------- | ------- | ------------------------------------------------------------ |
| `openai-compatible` | yes     | Any `/v1/chat/completions` endpoint, including local servers |
| `anthropic`         | yes     | Messages API with prompt-cache usage reporting               |
| `ollama`            | yes     | Local models, usage from `prompt_eval_count`/`eval_count`    |
| `openrouter`        | yes     | OpenAI-compatible with OpenRouter defaults                   |
| `zai`               | yes     | Z.ai OpenAI-compatible defaults                              |
| `custom`            | yes     | Anything you point at explicitly                             |

## Examples

Local model with Ollama:

```json
{
  "defaultProvider": "ollama",
  "defaultModel": "qwen2.5-coder:14b",
  "providers": {
    "ollama": {
      "type": "ollama",
      "baseUrl": "http://localhost:11434",
      "models": ["qwen2.5-coder:14b"]
    }
  }
}
```

A self-hosted gateway (vLLM, llama.cpp server, LiteLLM) speaks the OpenAI dialect:

```json
{
  "providers": {
    "local": {
      "type": "openai-compatible",
      "baseUrl": "http://localhost:8000/v1",
      "models": ["my-model"]
    }
  }
}
```

## Choosing per run

`larecode run` accepts `--provider` and `--model` overrides for a single task:

```bash
larecode run "explain the auth flow" --provider ollama --model qwen2.5-coder:14b
```

Usage is reported by the provider when it emits token counts; otherwise larecode falls back to a character-based estimate. Costs use a built-in price table for known models; unknown models report zero cost.
