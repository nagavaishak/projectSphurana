import { getAIClient } from './client.js';
import { RATE_LIMIT_MESSAGE, isRateLimitError } from './errors.js';
import type { EmbeddingOptions } from './types.js';

const DEFAULT_MODEL: NonNullable<EmbeddingOptions['model']> =
  'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;

/**
 * Generate a single embedding vector for one text input.
 *
 * Defaults to OpenAI `text-embedding-3-small` at 1536 dimensions to match the
 * rest of the workspace (voice-embedding, assistant.knowledgeEntry). Callers
 * that need a different model + dims pass them explicitly — the pgvector
 * column dimension must match.
 */
export async function generateEmbedding(
  text: string,
  options?: EmbeddingOptions
): Promise<number[]> {
  const client = getAIClient();
  const model = options?.model ?? DEFAULT_MODEL;
  const dimensions = options?.dimensions ?? DEFAULT_DIMENSIONS;

  try {
    const response = await client.embeddings.create({
      model,
      input: text,
      dimensions,
    });

    return response.data[0].embedding;
  } catch (error) {
    if (isRateLimitError(error)) {
      throw new Error(RATE_LIMIT_MESSAGE);
    }
    throw error;
  }
}

/**
 * Batch embedding generation. Order of output matches order of input.
 *
 * OpenAI accepts arrays up to 2048 inputs per request. Callers with more
 * should chunk — this helper does NOT chunk for you on purpose so the caller
 * keeps control over rate-limit backoff semantics.
 */
export async function generateEmbeddings(
  texts: string[],
  options?: EmbeddingOptions
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getAIClient();
  const model = options?.model ?? DEFAULT_MODEL;
  const dimensions = options?.dimensions ?? DEFAULT_DIMENSIONS;

  try {
    const response = await client.embeddings.create({
      model,
      input: texts,
      dimensions,
    });

    // OpenAI returns entries keyed by `index`; the API contract says they
    // arrive in order, but sort defensively.
    return response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  } catch (error) {
    if (isRateLimitError(error)) {
      throw new Error(RATE_LIMIT_MESSAGE);
    }
    throw error;
  }
}
