import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initAnthropicClient,
  resetAnthropicClient,
} from './anthropic-client.js';
import { anthropicChatCompletion } from './anthropic-completions.js';

type MessagesCreate = (
  input: Anthropic.MessageCreateParamsNonStreaming
) => Promise<Anthropic.Message>;

let create: ReturnType<
  typeof vi.fn<Parameters<MessagesCreate>, ReturnType<MessagesCreate>>
>;

const buildResponse = (
  overrides: Partial<Anthropic.Message> = {}
): Anthropic.Message =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'hello' }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 3,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...overrides,
  }) as unknown as Anthropic.Message;

beforeEach(() => {
  initAnthropicClient({ apiKey: 'test-key' });
  // Replace the real SDK method with a spy.
  create = vi.fn();
  // biome-ignore lint/suspicious/noExplicitAny: test-only mutation.
  const client = globalThis as any;
  void client; // keep biome happy
});

afterEach(() => {
  resetAnthropicClient();
  vi.restoreAllMocks();
});

describe('anthropicChatCompletion', () => {
  it('forwards messages + system blocks + cache_control to the SDK', async () => {
    // Spy on the singleton's messages.create.
    const { getAnthropicClient } = await import('./anthropic-client.js');
    const client = getAnthropicClient();
    create = vi
      .fn<Parameters<MessagesCreate>, ReturnType<MessagesCreate>>()
      .mockResolvedValue(buildResponse());
    vi.spyOn(client.messages, 'create').mockImplementation(
      create as unknown as typeof client.messages.create
    );

    await anthropicChatCompletion({
      systemBlocks: [
        { type: 'text', text: 'stable prefix', cacheControl: true },
        { type: 'text', text: 'volatile suffix' },
      ],
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 128,
      temperature: 0.5,
    });

    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    expect(call.max_tokens).toBe(128);
    expect(call.temperature).toBe(0.5);
    expect(call.system).toEqual([
      {
        type: 'text',
        text: 'stable prefix',
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: 'volatile suffix' },
    ]);
    expect(call.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('concatenates text blocks and surfaces cache-usage fields', async () => {
    const { getAnthropicClient } = await import('./anthropic-client.js');
    const client = getAnthropicClient();
    create = vi
      .fn<Parameters<MessagesCreate>, ReturnType<MessagesCreate>>()
      .mockResolvedValue(
        buildResponse({
          content: [
            { type: 'text', text: 'first ' },
            { type: 'text', text: 'second' },
          ] as Anthropic.Message['content'],
          usage: {
            input_tokens: 100,
            output_tokens: 5,
            cache_creation_input_tokens: 80,
            cache_read_input_tokens: 0,
            server_tool_use: null,
            service_tier: null,
          } as unknown as Anthropic.Message['usage'],
        })
      );
    vi.spyOn(client.messages, 'create').mockImplementation(
      create as unknown as typeof client.messages.create
    );

    const result = await anthropicChatCompletion({
      messages: [{ role: 'user', content: 'compute' }],
    });

    expect(result.content).toBe('first second');
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 5,
      cacheCreationInputTokens: 80,
      cacheReadInputTokens: 0,
    });
  });

  it('ignores non-text output blocks in the concatenation', async () => {
    const { getAnthropicClient } = await import('./anthropic-client.js');
    const client = getAnthropicClient();
    create = vi
      .fn<Parameters<MessagesCreate>, ReturnType<MessagesCreate>>()
      .mockResolvedValue(
        buildResponse({
          content: [
            { type: 'text', text: 'keep' },
            // biome-ignore lint/suspicious/noExplicitAny: non-text block stub
            { type: 'tool_use' as any, id: 'x', name: 'y', input: {} },
            { type: 'text', text: 'me' },
          ] as unknown as Anthropic.Message['content'],
        })
      );
    vi.spyOn(client.messages, 'create').mockImplementation(
      create as unknown as typeof client.messages.create
    );

    const result = await anthropicChatCompletion({
      messages: [{ role: 'user', content: 'go' }],
    });

    expect(result.content).toBe('keepme');
  });

  it('throws friendly message on rate-limit errors', async () => {
    const { getAnthropicClient } = await import('./anthropic-client.js');
    const client = getAnthropicClient();
    const err = new Error('429 too many requests');
    vi.spyOn(client.messages, 'create').mockRejectedValue(err);

    await expect(
      anthropicChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
      })
    ).rejects.toThrow('AI service is temporarily busy');
  });
});
