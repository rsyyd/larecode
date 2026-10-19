# SDK and editors

Two integration surfaces, both built on the same core.

## TypeScript SDK

`@lumpscode/sdk` wraps the agent loop in a small client. It is pure TypeScript with no Bun-specific APIs, so it runs on Node 20+.

```ts
import { LumpsClient } from '@lumpscode/sdk';

const client = new LumpsClient({
  workingDir: process.cwd(),
  provider: 'openai-compatible',
  model: 'gpt-4o',
});

const result = await client.run('explain this repository', {
  onChunk: (text) => process.stdout.write(text),
});

console.log(result.stopReason); // 'end_turn' | 'max_tokens' | 'cancelled'
console.log(result.usage.totalTokens); // { input, output, cacheRead, total }
console.log(result.sessionId); // persisted; pass it back for a follow-up
```

Continue a conversation by passing the session id:

```ts
await client.run('now list the three riskiest files', { sessionId: result.sessionId });
```

Cancel by aborting the signal:

```ts
const controller = new AbortController();
const run = client.run('long task', { signal: controller.signal });
controller.abort();
// run resolves with stopReason 'cancelled' and the text so far
```

Sessions persist through the same store the CLI uses, so a conversation started in the SDK shows up in `sessions` and can be shared with `lumpscode serve`.

## ACP for editors

`lumpscode acp` speaks the Agent Client Protocol v1 over stdio, which is what editors like Zed use to host agents.

```json
{
  "agent_servers": {
    "Lumps Code": {
      "command": "lumpscode",
      "args": ["acp"]
    }
  }
}
```

The adapter implements `initialize`, `session/new`, `session/prompt` with streamed `session/update` notifications, and `session/cancel`. Budget halts map to the protocol's `max_tokens` stop reason; user cancellations map to `cancelled`. Unknown sessions and malformed JSON return proper JSON-RPC errors without tearing down the connection.

## Choosing between them

| Need                              | Use                                                |
| --------------------------------- | -------------------------------------------------- |
| Embed the agent in a Node service | `@lumpscode/sdk`                                   |
| Host inside an editor             | `lumpscode acp`                                    |
| Expose tools to another agent     | `lumpscode mcp serve` ([mcp.md](mcp.md))           |
| Drive it from other processes     | `lumpscode serve` ([automation.md](automation.md)) |
