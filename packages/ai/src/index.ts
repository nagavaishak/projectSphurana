/**
 * @borradh-workspace/ai
 *
 * Shared AI/LLM utilities for the workspace.
 * Provides a unified interface for OpenAI operations.
 */

// Client (OpenAI)
export {
  initAIClient,
  getAIClient,
  getAIConfig,
  isAIClientInitialized,
  getDefaultModel,
  getDefaultMaxTokens,
  getDefaultReasoningEffort,
  resetAIClient,
  createAIClient,
} from './client.js';

// Canonical model choices by task tier — prefer these over literal model ids.
export { MODELS, type ModelTier } from './models.js';

// Model-family parameter translation (GPT-5.x reasoning vs GPT-4 sampling).
export { buildSamplingParams, isReasoningModel } from './model-params.js';

// Client (Anthropic)
export {
  initAnthropicClient,
  getAnthropicClient,
  getAnthropicConfig,
  isAnthropicClientInitialized,
  getDefaultAnthropicModel,
  getDefaultAnthropicMaxTokens,
  resetAnthropicClient,
  createAnthropicClient,
} from './anthropic-client.js';

// Completions
export {
  chatCompletion,
  visionCompletion,
  streamChatCompletion,
} from './completions.js';

// Anthropic completions
export { anthropicChatCompletion } from './anthropic-completions.js';

// OpenAI embeddings (shared model: text-embedding-3-small at 1536 dims)
export { generateEmbedding, generateEmbeddings } from './embeddings.js';

// JSON parsing
export {
  extractJson,
  parseJsonResponse,
  safeGet,
  safeGetArray,
  safeGetStringArray,
} from './json-parser.js';

// Errors
export {
  isRateLimitError,
  RATE_LIMIT_MESSAGE,
  classifyStreamError,
  type StreamErrorClassification,
} from './errors.js';

// Types
export type {
  AIModel,
  AIClientConfig,
  AnthropicClientConfig,
  AnthropicModel,
  AnthropicTextBlock,
  AnthropicRole,
  AnthropicMessage,
  AnthropicChatCompletionOptions,
  AnthropicChatCompletionResult,
  AnthropicUsage,
  AiObservabilityCallOptions,
  ChatCompletionOptions,
  ChatCompletionResult,
  EmbeddingOptions,
  JsonExtractionOptions,
  JsonExtractionResult,
  VisionOptions,
  ImageInput,
  OpenAI,
} from './types.js';

// Re-export the Anthropic SDK default class for callers that need direct
// access to `client.messages.stream(...)`, `client.messages.create(...)`,
// content block types, etc. The decision is to use the SDK directly — see
// claire.md §2 (Backend architecture: SDK).
export { default as Anthropic } from '@anthropic-ai/sdk';
