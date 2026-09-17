import type OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAIClient, initAIClient, resetAIClient } from './client.js';
import { generateEmbedding, generateEmbeddings } from './embeddings.js';

type EmbeddingsCreate = OpenAI.Embeddings['create'];

beforeEach(() => {
  initAIClient({ apiKey: 'test-key' });
});

afterEach(() => {
  resetAIClient();
  vi.restoreAllMocks();
});

function mockEmbeddingsCreate(
  handler: (input: Parameters<EmbeddingsCreate>[0]) => Promise<unknown>
) {
  const client = getAIClient();
  vi.spyOn(client.embeddings, 'create').mockImplementation(
    handler as unknown as typeof client.embeddings.create
  );
}

describe('generateEmbedding', () => {
  it('returns the first vector in the response', async () => {
    mockEmbeddingsCreate(async (input) => {
      expect(input.model).toBe('text-embedding-3-small');
      expect(input.dimensions).toBe(1536);
      expect(input.input).toBe('hello');
      return {
        data: [{ index: 0, object: 'embedding', embedding: [0.1, 0.2] }],
        model: 'text-embedding-3-small',
        object: 'list',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      };
    });

    const result = await generateEmbedding('hello');
    expect(result).toEqual([0.1, 0.2]);
  });

  it('forwards custom dimensions / model', async () => {
    mockEmbeddingsCreate(async (input) => {
      expect(input.model).toBe('text-embedding-3-large');
      expect(input.dimensions).toBe(3072);
      return {
        data: [{ index: 0, object: 'embedding', embedding: [1] }],
        model: 'text-embedding-3-large',
        object: 'list',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      };
    });

    await generateEmbedding('hi', {
      model: 'text-embedding-3-large',
      dimensions: 3072,
    });
  });
});

describe('generateEmbeddings', () => {
  it('returns empty array when given empty input without calling the API', async () => {
    const spy = vi.fn();
    const client = getAIClient();
    vi.spyOn(client.embeddings, 'create').mockImplementation(
      spy as unknown as typeof client.embeddings.create
    );

    const result = await generateEmbeddings([]);
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns vectors sorted by index', async () => {
    mockEmbeddingsCreate(async () => ({
      data: [
        { index: 1, object: 'embedding', embedding: [2] },
        { index: 0, object: 'embedding', embedding: [1] },
      ],
      model: 'text-embedding-3-small',
      object: 'list',
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }));

    const result = await generateEmbeddings(['a', 'b']);
    expect(result).toEqual([[1], [2]]);
  });

  it('wraps rate-limit errors with a friendly message', async () => {
    mockEmbeddingsCreate(async () => {
      throw new Error('429 rate limit exceeded');
    });

    await expect(generateEmbeddings(['a'])).rejects.toThrow(
      'AI service is temporarily busy'
    );
  });
});
