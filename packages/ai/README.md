# `@borradh-workspace/ai`

Shared LLM utilities for the workspace. Two providers are wrapped with a
thin singleton + factory pattern:

| Provider | Use cases | Default model |
|---|---|---|
| OpenAI | website analysis, embeddings, generic chat completions | `gpt-4o` |
| Anthropic | Claire-Owner v3 (chat + tool use + extended thinking) | `claude-sonnet-4-6` |

The package is intentionally thin — no provider-agnostic abstraction layer.
Callers reach for the SDK methods directly when they need streaming, tool
use, prompt caching, or extended thinking.

## Anthropic client

Added in W-C02-A as the foundation for Claire-Owner v3 (see
`docs/implementations/claire.md` §2 — Backend architecture). This is a
fresh implementation on `feat/claire-widget` and is independent of any
Anthropic surface that may exist on `feat/graphics` (`packages/graphics-ai`)
— that work will arrive on this branch via the standard staging→main flow.

### Singleton

```ts
import { initAnthropicClient, getAnthropicClient } from '@borradh-workspace/ai';

initAnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultModel: 'claude-sonnet-4-6',
  defaultMaxTokens: 4096,
});

const client = getAnthropicClient();
```

### Factory (no singleton)

```ts
import { createAnthropicClient } from '@borradh-workspace/ai';

// Falls back to process.env.ANTHROPIC_API_KEY if no arg.
const client = createAnthropicClient();
```

### Streaming

```ts
const stream = client.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  messages: [{ role: 'user', content: 'hello' }],
});

for await (const event of stream) {
  // content_block_start | content_block_delta | content_block_stop | message_*
}
```

### Tool use

```ts
const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  tools: [
    {
      name: 'getWeather',
      description: 'Look up weather for a city.',
      input_schema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  ],
  messages: [{ role: 'user', content: 'what is the weather in dublin?' }],
});
```

### Prompt caching (`cache_control: ephemeral`)

Mark stable system blocks and tool definitions for ephemeral caching. Keep
the dynamic, per-request block last and uncached.

```ts
await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: [
    { type: 'text', text: ORCHESTRATOR_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: SKILL_FRAGMENTS,    cache_control: { type: 'ephemeral' } },
    { type: 'text', text: requestSpecificContext },
  ],
  tools: [
    { ...definition, cache_control: { type: 'ephemeral' } },
  ],
  messages,
});
```

### Extended thinking

```ts
await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  thinking: { type: 'enabled', budget_tokens: 2000 },
  messages,
});
```

The streamed `thinking` content block surfaces the model's reasoning before
the user-facing `text` block. Claire's frontend renders this via the AI
Elements `reasoning` component (collapsed by default).

## What is NOT in this package

- The `defineTool` factory (W-C02-C — `apps/api/src/assistant/tool-factory/`)
- Controller wiring + AI SDK UI message stream protocol (W-C02-E — `apps/api/src/assistant/`)
- Prompt content / orchestrator + skill modules (Track C-03 — `packages/features/src/assistant/`)

This package only exposes the SDK and small init helpers. Anything richer
is the consumer's responsibility.
