import { beforeEach, describe, expect, it, vi } from 'vitest';
import { instrumentAnthropic, instrumentOpenAI } from './instrument.js';

// Capture is irrelevant to the contract under test — stub it so these tests
// don't depend on PostHog being initialized.
const captureAiGeneration = vi.fn();
const captureAiEmbedding = vi.fn();
vi.mock('@borradh-workspace/observability', () => ({
  captureAiGeneration: (...a: unknown[]) => captureAiGeneration(...a),
  captureAiEmbedding: (...a: unknown[]) => captureAiEmbedding(...a),
}));

/**
 * A fake SDK `APIPromise`: a real thenable that ALSO exposes `.withResponse()`.
 * The SDK's streaming helpers (e.g. Anthropic `messages.stream()`) call
 * `create(...).withResponse()` synchronously, so the instrumentation must
 * return an object that still carries that method.
 */
function fakeApiPromise<T>(value: T) {
  const p = Promise.resolve(value) as Promise<T> & {
    withResponse: () => Promise<{ data: T }>;
  };
  p.withResponse = () => Promise.resolve({ data: value });
  return p;
}

describe('instrument — APIPromise preservation (regression)', () => {
  beforeEach(() => {
    captureAiGeneration.mockClear();
    captureAiEmbedding.mockClear();
  });

  // Regression for: wrapping `create` with an `async` function returned a plain
  // Promise, dropping `.withResponse()` and throwing
  // "messages.create(...).withResponse is not a function" inside
  // `messages.stream()` — which broke every streamed Claire turn.
  it('Anthropic messages.create keeps .withResponse() (stream + non-stream)', async () => {
    const client = {
      baseURL: 'https://api.anthropic.com',
      messages: {
        create: vi.fn((_body: unknown) =>
          fakeApiPromise({
            model: 'claude-sonnet-4-6',
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          })
        ),
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake client
    } as any;

    instrumentAnthropic(client);

    const nonStream = client.messages.create({
      model: 'claude-sonnet-4-6',
      messages: [],
    });
    expect(typeof nonStream.withResponse).toBe('function');
    await expect(nonStream).resolves.toBeDefined();

    const streamed = client.messages.create({
      model: 'claude-sonnet-4-6',
      messages: [],
      stream: true,
    });
    // This is the exact call MessageStream.createMessage makes internally.
    expect(typeof streamed.withResponse).toBe('function');
    await expect(streamed.withResponse()).resolves.toBeDefined();
  });

  it('Anthropic non-streaming emits a generation event; streaming does not', async () => {
    const client = {
      baseURL: 'https://api.anthropic.com',
      messages: {
        create: vi.fn((_body: unknown) =>
          fakeApiPromise({
            model: 'claude-sonnet-4-6',
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 2, output_tokens: 3 },
          })
        ),
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake client
    } as any;
    instrumentAnthropic(client);

    await client.messages.create({ model: 'claude-sonnet-4-6', messages: [] });
    // capture is attached via .then — let the microtask flush.
    await Promise.resolve();
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);

    captureAiGeneration.mockClear();
    await client.messages
      .create({ model: 'claude-sonnet-4-6', messages: [], stream: true })
      .withResponse();
    await Promise.resolve();
    expect(captureAiGeneration).not.toHaveBeenCalled();
  });

  it('OpenAI chat.completions.create keeps .withResponse() (stream + non-stream)', async () => {
    const client = {
      baseURL: 'https://api.openai.com/v1',
      chat: {
        completions: {
          create: vi.fn((_body: unknown) =>
            fakeApiPromise({
              model: 'gpt-4o',
              choices: [{ message: { role: 'assistant', content: 'hi' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            })
          ),
        },
      },
      embeddings: { create: vi.fn((_b: unknown) => fakeApiPromise({})) },
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake client
    } as any;

    instrumentOpenAI(client);

    const nonStream = client.chat.completions.create({
      model: 'gpt-4o',
      messages: [],
    });
    expect(typeof nonStream.withResponse).toBe('function');
    await expect(nonStream).resolves.toBeDefined();

    const streamed = client.chat.completions.create({
      model: 'gpt-4o',
      messages: [],
      stream: true,
    });
    expect(typeof streamed.withResponse).toBe('function');
    await expect(streamed.withResponse()).resolves.toBeDefined();
  });

  it('OpenAI embeddings.create keeps .withResponse()', async () => {
    const client = {
      baseURL: 'https://api.openai.com/v1',
      chat: { completions: { create: vi.fn(() => fakeApiPromise({})) } },
      embeddings: {
        create: vi.fn((_b: unknown) =>
          fakeApiPromise({
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 4 },
          })
        ),
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake client
    } as any;
    instrumentOpenAI(client);

    const r = client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'hi',
    });
    expect(typeof r.withResponse).toBe('function');
    await expect(r).resolves.toBeDefined();
    await Promise.resolve();
    expect(captureAiEmbedding).toHaveBeenCalledTimes(1);
  });
});
