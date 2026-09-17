import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();

vi.mock('./client.js', () => ({
  getAIClient: () => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }),
  getDefaultModel: () => 'gpt-4o',
  getDefaultMaxTokens: () => 1000,
  getDefaultReasoningEffort: () => 'low',
}));

import {
  chatCompletion,
  streamChatCompletion,
  visionCompletion,
} from './completions.js';
import { RATE_LIMIT_MESSAGE } from './errors.js';

describe('chatCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns content and usage on success', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: 'Hello there' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });

    const result = await chatCompletion('Say hello');

    expect(result.content).toBe('Hello there');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('returns empty content when choices are empty', async () => {
    mockCreate.mockResolvedValue({
      choices: [{}],
      usage: null,
    });

    const result = await chatCompletion('Say hello');

    expect(result.content).toBe('');
    expect(result.finishReason).toBeNull();
    expect(result.usage).toBeUndefined();
  });

  it('passes system message when provided', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });

    await chatCompletion('Hello', { systemMessage: 'You are helpful' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      }),
      undefined
    );
  });

  it('passes json response format when requested', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    });

    await chatCompletion('Give JSON', { jsonResponse: true });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      }),
      undefined
    );
  });

  it('uses max_tokens + temperature for classic chat models (gpt-4o)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });

    await chatCompletion('Hello', { maxTokens: 500, temperature: 0.7 });

    const [body] = mockCreate.mock.calls[0];
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.7);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('uses max_completion_tokens and omits temperature for next-gen models (gpt-5.x)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });

    // Regression guard: gpt-5.x / o-series 400 on `max_tokens` and on a custom
    // `temperature`. They must receive `max_completion_tokens` and no temperature.
    await chatCompletion('Hello', {
      model: 'gpt-5.6-luna',
      maxTokens: 500,
      temperature: 0.7,
    });

    const [body] = mockCreate.mock.calls[0];
    // `max_completion_tokens` bounds reasoning AND the answer together, so the
    // caller's 500 is the budget for the ANSWER and reasoning headroom is added
    // on top (2000 at the default 'low' effort). Asserting 500 exactly would
    // pin the bug this design exists to prevent: reasoning eating the whole
    // allowance and returning finish_reason=length with empty content.
    expect(body.max_completion_tokens).toBe(2500);
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it('passes per-call timeout and retry limits when requested', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    });

    await chatCompletion('Give JSON', { timeoutMs: 90_000, maxRetries: 1 });

    expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), {
      timeout: 90_000,
      maxRetries: 1,
    });
  });

  it('throws RATE_LIMIT_MESSAGE when OpenAI throws a 429 error', async () => {
    mockCreate.mockRejectedValue(new Error('Request failed with status 429'));

    await expect(chatCompletion('Hello')).rejects.toThrow(RATE_LIMIT_MESSAGE);
  });

  it('re-throws non-rate-limit errors unchanged', async () => {
    const originalError = new Error('Network failure');
    mockCreate.mockRejectedValue(originalError);

    await expect(chatCompletion('Hello')).rejects.toThrow(originalError);
  });
});

describe('visionCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns content on success with URL images', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: 'I see a cat' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 5,
        total_tokens: 25,
      },
    });

    const result = await visionCompletion('What is in this image?', [
      { url: 'https://example.com/cat.jpg' },
    ]);

    expect(result.content).toBe('I see a cat');
    expect(result.finishReason).toBe('stop');
  });

  it('passes per-call timeout and retry limits when requested', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    });

    await visionCompletion('Read this', [{ base64: 'abc' }], {
      timeoutMs: 60_000,
      maxRetries: 1,
    });

    // `chatCompletion` forwarded both; `visionCompletion` used to forward only
    // `timeout`, so a caller that owned its own retry policy still got the
    // SDK's default 3 retries on top of it.
    expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), {
      timeout: 60_000,
      maxRetries: 1,
    });
  });

  it('handles base64 images with custom mime type', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A dog' }, finish_reason: 'stop' }],
    });

    await visionCompletion('Describe', [
      { base64: 'abc123', mimeType: 'image/png' },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              { type: 'text', text: 'Describe' },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,abc123',
                  detail: 'low',
                },
              },
            ]),
          }),
        ]),
      }),
      undefined
    );
  });

  it('defaults to image/jpeg for base64 without mimeType', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });

    await visionCompletion('Describe', [{ base64: 'abc' }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                image_url: expect.objectContaining({
                  url: 'data:image/jpeg;base64,abc',
                }),
              }),
            ]),
          }),
        ]),
      }),
      undefined
    );
  });

  it('throws RATE_LIMIT_MESSAGE on rate limit', async () => {
    mockCreate.mockRejectedValue(new Error('429 rate limit exceeded'));

    await expect(
      visionCompletion('Describe', [{ url: 'https://example.com/img.jpg' }])
    ).rejects.toThrow(RATE_LIMIT_MESSAGE);
  });

  it('re-throws non-rate-limit errors', async () => {
    const err = new Error('Server error');
    mockCreate.mockRejectedValue(err);

    await expect(
      visionCompletion('Describe', [{ url: 'https://example.com/img.jpg' }])
    ).rejects.toThrow(err);
  });
});

describe('streamChatCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields content chunks on success', async () => {
    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: 'Hello' } }] };
        yield { choices: [{ delta: { content: ' World' } }] };
      },
    });

    const chunks: string[] = [];
    for await (const chunk of streamChatCompletion('Say hello')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' World']);
  });

  it('skips chunks with no content', async () => {
    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: 'Hi' } }] };
        yield { choices: [{ delta: {} }] };
        yield { choices: [{ delta: { content: ' there' } }] };
      },
    });

    const chunks: string[] = [];
    for await (const chunk of streamChatCompletion('Say hi')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hi', ' there']);
  });

  it('throws RATE_LIMIT_MESSAGE on rate limit', async () => {
    mockCreate.mockRejectedValue(new Error('rate limit reached'));

    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of streamChatCompletion('Hello')) {
        chunks.push(chunk);
      }
    }).rejects.toThrow(RATE_LIMIT_MESSAGE);
  });

  it('re-throws non-rate-limit errors', async () => {
    const err = new Error('Connection refused');
    mockCreate.mockRejectedValue(err);

    await expect(async () => {
      for await (const _chunk of streamChatCompletion('Hello')) {
        // consume
      }
    }).rejects.toThrow(err);
  });
});
