import {
  RATE_LIMIT_MESSAGE,
  getAIClient,
  initAIClient,
  isAIClientInitialized,
  isRateLimitError,
} from '@borradh-workspace/ai';
import { logError } from '@borradh-workspace/observability';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Ensure the AI client is initialized.
 * Lazily initializes using OPENAI_API_KEY env var if not already done.
 */
function ensureClient() {
  if (!isAIClientInitialized()) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set — cannot generate embeddings');
    }
    initAIClient({ apiKey });
  }
  return getAIClient();
}

/**
 * Generate an embedding vector for a single text string.
 * Uses OpenAI text-embedding-3-small (1536 dimensions).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = ensureClient();

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
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
 * Generate embeddings for multiple texts in a single API call.
 * Returns embeddings in the same order as the input texts.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = ensureClient();

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    // Sort by index to ensure order matches input
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  } catch (error) {
    if (isRateLimitError(error)) {
      throw new Error(RATE_LIMIT_MESSAGE);
    }
    logError('assistant.generateEmbeddings', error, {
      feature: 'assistant',
      extra: { textCount: texts.length },
    });
    throw error;
  }
}
