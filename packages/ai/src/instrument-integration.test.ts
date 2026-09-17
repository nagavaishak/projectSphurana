import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instrumentAnthropic, instrumentOpenAI } from './instrument.js';

/**
 * Deep integration tests for the client instrumentation.
 *
 * Unlike instrument.test.ts (which uses a fake APIPromise), these construct the
 * REAL OpenAI / Anthropic SDK clients with an injected mock `fetch`, instrument
 * them, and drive them through the actual package wrappers
 * (`chatCompletion` / `streamChatCompletion` / `generateEmbedding` /
 * `anthropicChatCompletion`) plus the real `messages.stream()` helper.
 *
 * This exercises the exact production path — SDK request build → instrumentation
 * → SDK response parse → wrapper — with only the HTTP transport faked. It is the
 * regression guard for "messages.create(...).withResponse is not a function" and
 * proves the customer chatbot's `chatCompletion` call survives instrumentation.
 */

const captureAiGeneration = vi.fn();
const captureAiEmbedding = vi.fn();
vi.mock('@borradh-workspace/observability', () => ({
  captureAiGeneration: (...a: unknown[]) => captureAiGeneration(...a),
  captureAiEmbedding: (...a: unknown[]) => captureAiEmbedding(...a),
}));

// The wrappers resolve their client + defaults from these modules; point them
// at the instrumented, mock-fetch-backed clients built per test.
let openaiClient: OpenAI;
let anthropicClient: Anthropic;

vi.mock('./client.js', () => ({
  getAIClient: () => openaiClient,
  getDefaultModel: () => 'gpt-4o',
  getDefaultMaxTokens: () => 1024,
  getDefaultReasoningEffort: () => 'low',
}));
vi.mock('./anthropic-client.js', () => ({
  getAnthropicClient: () => anthropicClient,
  getDefaultAnthropicModel: () => 'claude-sonnet-4-6',
  getDefaultAnthropicMaxTokens: () => 1024,
}));

// Imported AFTER the mocks above so they pick up the mocked client modules.
const { chatCompletion, streamChatCompletion } = await import(
  './completions.js'
);
const { generateEmbedding } = await import('./embeddings.js');
const { anthropicChatCompletion } = await import('./anthropic-completions.js');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(chunks: string[]): Response {
  const payload = chunks.map((c) => `${c}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

beforeEach(() => {
  captureAiGeneration.mockClear();
  captureAiEmbedding.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAI — real SDK through instrumentation (chatbot path)', () => {
  it('chatCompletion returns parsed content + usage and emits one event', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: 'cmpl_1',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"reply":"hi"}' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    );
    openaiClient = instrumentOpenAI(
      // biome-ignore lint/suspicious/noExplicitAny: test fetch injection
      new OpenAI({ apiKey: 'sk-test', maxRetries: 0, fetch: fetchMock as any })
    );

    const result = await chatCompletion('hello', {
      jsonResponse: true,
      observability: { distinctId: 'org_1', spanName: 'chatbots.test' },
    });

    expect(result.content).toBe('{"reply":"hi"}');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // posthog* attribution fields must be stripped before hitting the SDK body.
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body
    );
    expect(body.posthogDistinctId).toBeUndefined();
    expect(body.posthogSpanName).toBeUndefined();
    expect(body.response_format).toEqual({ type: 'json_object' });
    // capture is attached via .then — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
    expect(captureAiGeneration.mock.calls[0][0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('chatCompletion maps a 429 to the rate-limit message and records an error event', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'slow down', type: 'rate_limit' } }, 429)
    );
    openaiClient = instrumentOpenAI(
      // biome-ignore lint/suspicious/noExplicitAny: test fetch injection
      new OpenAI({ apiKey: 'sk-test', maxRetries: 0, fetch: fetchMock as any })
    );

    await expect(chatCompletion('hello')).rejects.toThrow(/rate limit|busy/i);
    await Promise.resolve();
    await Promise.resolve();
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
    expect(captureAiGeneration.mock.calls[0][0]).toMatchObject({
      provider: 'openai',
      isError: true,
    });
  });

  it('streamChatCompletion yields deltas and records usage at stream end', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'data: {"id":"c","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}',
        'data: {"choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
        'data: [DONE]',
      ])
    );
    openaiClient = instrumentOpenAI(
      // biome-ignore lint/suspicious/noExplicitAny: test fetch injection
      new OpenAI({ apiKey: 'sk-test', maxRetries: 0, fetch: fetchMock as any })
    );

    const out: string[] = [];
    for await (const chunk of streamChatCompletion('hi')) out.push(chunk);

    expect(out.join('')).toBe('Hello');
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
    expect(captureAiGeneration.mock.calls[0][0]).toMatchObject({
      provider: 'openai',
      outputTokens: 2,
    });
  });

  it('generateEmbedding returns the vector and emits an embedding event', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 4, total_tokens: 4 },
      })
    );
    openaiClient = instrumentOpenAI(
      // biome-ignore lint/suspicious/noExplicitAny: test fetch injection
      new OpenAI({ apiKey: 'sk-test', maxRetries: 0, fetch: fetchMock as any })
    );

    const vec = await generateEmbedding('hi');
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    await Promise.resolve();
    await Promise.resolve();
    expect(captureAiEmbedding).toHaveBeenCalledTimes(1);
  });
});

describe('Anthropic — real SDK through instrumentation', () => {
  it('anthropicChatCompletion returns parsed text + usage', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hi there' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 7, output_tokens: 3 },
      })
    );
    anthropicClient = instrumentAnthropic(
      new Anthropic({
        apiKey: 'sk-ant',
        maxRetries: 0,
        // biome-ignore lint/suspicious/noExplicitAny: test fetch injection
        fetch: fetchMock as any,
      })
    );

    const result = await anthropicChatCompletion({
      messages: [{ role: 'user', content: 'hey' }],
    });
    expect(result.content).toBe('hi there');
    expect(result.usage.inputTokens).toBe(7);
    await Promise.resolve();
    await Promise.resolve();
    expect(captureAiGeneration).toHaveBeenCalledTimes(1);
  });

  // THE regression: messages.stream() internally calls
  // messages.create(...).withResponse(). With an async wrapper this threw
  // "withResponse is not a function" and broke every Claire turn.
  it('messages.stream() works end-to-end through the wrapper', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":7,"output_tokens":0}}}',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":3}}',
        'event: message_stop\ndata: {"type":"message_stop"}',
      ])
    );
    anthropicClient = instrumentAnthropic(
      new Anthropic({
        apiKey: 'sk-ant',
        maxRetries: 0,
        // biome-ignore lint/suspicious/noExplicitAny: test fetch injection
        fetch: fetchMock as any,
      })
    );

    const stream = anthropicClient.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hey' }],
    });

    let text = '';
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        text += event.delta.text;
      }
    }
    const final = await stream.finalMessage();

    expect(text).toBe('hi');
    expect(final.stop_reason).toBe('end_turn');
    expect(final.usage.output_tokens).toBe(3);
  });
});
