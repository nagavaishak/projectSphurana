/**
 * AI Package Types
 *
 * Shared types for AI/LLM operations across the workspace.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';

/**
 * Supported AI models
 */
export type AIModel =
  // GPT-5.6 family — reasoning models. These take different request
  // parameters to the GPT-4 family; see `model-params.ts`. `gpt-5.6` is an
  // alias that routes to Sol; `gpt-5.6-luna` is the fast, low-cost member and
  // is this workspace's default (cheaper AND stronger than gpt-4o).
  | 'gpt-5.6'
  | 'gpt-5.6-luna'
  // GPT-4 family — legacy. Retained so pinned call sites and existing tests
  // keep compiling; prefer the MODELS map over adding new usages.
  | 'gpt-4.1'
  | 'gpt-4.1-mini'
  | 'gpt-4.1-nano'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'gpt-4'
  | 'gpt-3.5-turbo';

/**
 * Reasoning effort for GPT-5.x models. Higher levels trade latency and output
 * tokens for answer quality.
 *
 * `none` is special: it disables reasoning entirely, and is the ONLY level at
 * which GPT-5.6+ accepts function tools on the Chat Completions API. Any call
 * site that attaches tools must pin `none` or move to the Responses API.
 */
export type ReasoningEffort =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

/**
 * Configuration for the AI client
 */
export interface AIClientConfig {
  apiKey: string;
  defaultModel?: AIModel;
  defaultMaxTokens?: number;
  /**
   * Default reasoning effort applied to GPT-5.x calls that don't specify one.
   * Ignored by GPT-4-family models. Defaults to `low`.
   */
  defaultReasoningEffort?: ReasoningEffort;
  organization?: string;
  /**
   * Default per-request timeout in ms. The OpenAI SDK otherwise defaults to
   * 10 minutes, which lets a single stuck completion hang a request or worker.
   * Defaults to 60s; individual calls can override via `timeoutMs`.
   */
  timeoutMs?: number;
}

/**
 * Options for chat completions
 */
export interface ChatCompletionOptions {
  /** The model to use (defaults to config default or gpt-4o) */
  model?: AIModel;
  /**
   * Maximum tokens for the VISIBLE answer. On reasoning models this is not
   * passed through verbatim — `buildSamplingParams` adds reasoning headroom on
   * top, so this keeps meaning "room for the reply" on every model family.
   */
  maxTokens?: number;
  /**
   * Temperature for randomness (0-2, default 1).
   *
   * IGNORED on GPT-5.x reasoning models — the API rejects the parameter, so it
   * is dropped rather than forwarded. Left in the interface because GPT-4-era
   * call sites still pass it and it remains meaningful for those models.
   */
  temperature?: number;
  /**
   * Reasoning effort for GPT-5.x models. Falls back to the client default
   * (`low`). No effect on GPT-4-family models.
   */
  reasoningEffort?: ReasoningEffort;
  /** Whether to request JSON response format */
  jsonResponse?: boolean;
  /** System message to set context */
  systemMessage?: string;
  /**
   * Deterministic seed for sampling. OpenAI honours this on a best-effort
   * basis — same seed + same params → same output when the model permits.
   * Passing this through is required for §10 invariant 3 (deterministic
   * synthesis); callers should not crash if the model ignores it.
   */
  seed?: number;
  /**
   * Optional PostHog LLM-observability attribution for this call. Use it when
   * the call runs outside an authenticated HTTP request (e.g. the
   * webhook/queue-driven chatbot) so the captured `$ai_generation` event is
   * still attributed to the right org/user/trace. Inside a request,
   * attribution falls back to the ambient observability context automatically.
   */
  observability?: AiObservabilityCallOptions;
  /**
   * Per-call timeout override in ms. Falls back to the client's configured
   * default (60s). Bounds a single completion so a stuck upstream can't hang
   * the caller indefinitely.
   */
  timeoutMs?: number;
  /**
   * Per-call retry limit for retryable OpenAI failures. Falls back to the
   * client's configured default (3). Long-running operations should set this
   * deliberately so retries remain inside their own job deadline.
   */
  maxRetries?: number;
}

/**
 * Per-call PostHog LLM-observability attribution forwarded to the
 * `$ai_generation` event captured by the shared AI clients.
 */
export interface AiObservabilityCallOptions {
  /** Distinct id (e.g. acting user id, or org id for system calls). */
  distinctId?: string;
  /** Trace id grouping related generations (e.g. a conversation id). */
  traceId?: string;
  /** Human-readable span name, e.g. `chatbots.generateAiResponse`. */
  spanName?: string;
  /** Groups to attribute to, e.g. `{ organization: orgId }`. */
  groups?: Record<string, string>;
  /** Extra custom properties merged onto the event. */
  properties?: Record<string, unknown>;
}

/**
 * Result of a chat completion
 */
export interface ChatCompletionResult {
  content: string;
  finishReason: string | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Options for JSON extraction
 */
export interface JsonExtractionOptions<T> extends ChatCompletionOptions {
  /** Zod schema for validation (optional) */
  schema?: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: unknown;
    };
  };
  /** Default value if extraction fails */
  defaultValue?: T;
}

/**
 * Result of JSON extraction
 */
export interface JsonExtractionResult<T> {
  success: boolean;
  data: T | null;
  raw?: string;
  error?: string;
}

/**
 * Vision analysis options
 */
export interface VisionOptions extends ChatCompletionOptions {
  /** Image detail level */
  detail?: 'low' | 'high' | 'auto';
}

/**
 * Image input for vision
 */
export interface ImageInput {
  /** Base64-encoded image data */
  base64?: string;
  /** Image URL */
  url?: string;
  /** MIME type (defaults to image/jpeg) */
  mimeType?: string;
}

/**
 * Re-export OpenAI types that consumers might need
 */
export type { OpenAI };

/**
 * Anthropic Claude models supported by the workspace.
 *
 * Sonnet 4.6 is the default for Claire-Owner v3; Opus 4.7 is the routed
 * upgrade triggered per skill. Haiku 4.5 is reserved for the intent
 * classifier (C-03) and other latency-sensitive paths.
 */
export type AnthropicModel =
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'
  | 'claude-haiku-4-5-20251001';

/**
 * Configuration for the Anthropic client.
 */
export interface AnthropicClientConfig {
  apiKey: string;
  defaultModel?: AnthropicModel;
  defaultMaxTokens?: number;
  /** Override the API base URL (e.g. for proxy/test fixtures). */
  baseURL?: string;
  /** SDK retry count on retryable failures. Defaults to 3. */
  maxRetries?: number;
}

/**
 * A prompt "block" for Anthropic messages. Mirrors the shape the SDK accepts
 * but kept provider-neutral here so callers can assemble the structured input
 * without importing the SDK. `cacheControl: true` marks the block as a prefix
 * to cache (see §8 caching strategy).
 */
export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  /** Mark this block as cacheable (ephemeral TTL). */
  cacheControl?: boolean;
}

export type AnthropicRole = 'user' | 'assistant';

export interface AnthropicMessage {
  role: AnthropicRole;
  /** Either plain text or an ordered list of text blocks (enables cache_control). */
  content: string | AnthropicTextBlock[];
}

/**
 * Options for `anthropicChatCompletion`.
 *
 * - `systemBlocks` is an ordered list (NOT a single string) so stable prefix
 *   content can be marked `cacheControl: true` individually. Use a single
 *   unmarked block if you don't need caching.
 */
export interface AnthropicChatCompletionOptions {
  model?: AnthropicModel;
  maxTokens?: number;
  temperature?: number;
  /** System prompt expressed as an ordered list of blocks. Marked blocks cache. */
  systemBlocks?: AnthropicTextBlock[];
  /** Conversation turns (user + assistant). Final turn should be `role: 'user'`. */
  messages: AnthropicMessage[];
  /** Stop sequences forwarded to the SDK as-is. */
  stopSequences?: string[];
}

export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens that primed the cache on THIS call (billed at 1.25× input rate). */
  cacheCreationInputTokens?: number;
  /** Tokens served from the cache on THIS call (billed at 0.1× input rate). */
  cacheReadInputTokens?: number;
}

export interface AnthropicChatCompletionResult {
  /** Concatenated text content across all output blocks. */
  content: string;
  stopReason: string | null;
  model: string;
  usage: AnthropicUsage;
}

/**
 * Re-export Anthropic types that consumers might need (rare — prefer the
 * wrapper types above so we don't couple to SDK internals).
 */
export type { Anthropic };

// ===================== EMBEDDINGS =====================

export interface EmbeddingOptions {
  /** OpenAI embeddings model. Defaults to text-embedding-3-small (1536 dims). */
  model?: 'text-embedding-3-small' | 'text-embedding-3-large';
  /** Output dimensions. Defaults to 1536 — matches the workspace convention. */
  dimensions?: number;
}
