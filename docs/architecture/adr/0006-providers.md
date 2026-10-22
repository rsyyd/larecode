# ADR-0006: Providers

Status: accepted

## Context

The product ships provider-neutral, but every provider API differs in auth, streaming, usage reporting, and capability. Users need one config shape and one failure story.

## Decision

A provider is a name + type + baseUrl + model list in config. Adapters implement a common stream contract (`ProviderAdapter`), with `OpenAIAdapter`, `AnthropicAdapter`, `OllamaAdapter`, and custom endpoints. Streaming/usage/capability metadata is reported per provider, and cheap local backends (Ollama) can skip adding an API key. `doctor` checks auth, reachability, model presence, and streaming per configured model, with fix suggestions. Fallbacks are explicit: `config.fallbacks` lists provider/model chains, an event is emitted on switch, and the runtime only falls back when the primary produced no text or tool output yet.

## Consequences

- Adding a provider means one adapter, not changes to the loop.
- Explicit fallback keeps behavior predictable and observable.
- Usage and cost are estimates calibrated with a smoothing ratio from observed totals; they are not billable figures.
