import { captureAiGeneration } from '@borradh-workspace/observability';
import type OpenAI from 'openai';
import {
  getAIClient,
  getDefaultMaxTokens,
  getDefaultModel,
  getDefaultReasoningEffort,
} from './client.js';
import { RATE_LIMIT_MESSAGE, isRateLimitError } from './errors.js';
import { buildSamplingParams } from './model-params.js';
import { MODELS } from './models.js';
import type {
  AiObservabilityCallOptions,
  ChatCompletionOptions,
  ChatCompletionResult,
  ImageInput,
  VisionOptions,
} from './types.js';

/**
 * Build the `posthog*` request-body fields the client-level instrumentation
 * reads to attribute the captured `$ai_generation` event, then strips before
 * the body reaches the SDK. No-op object when no attribution is provided.
 */
function posthogBodyParams(
  obs: AiObservabilityCallOptions | undefined
): Record<string, unknown> {
  if (!obs) return {};
  const out: Record<string, unknown> = {};
  if (obs.distinctId) out.posthogDistinctId = obs.distinctId;
  if (obs.traceId) out.posthogTraceId = obs.traceId;
  if (obs.spanName) out.posthogSpanName = obs.spanName;
  if (obs.groups) out.posthogGroups = obs.groups;
  if (obs.properties) out.posthogProperties = obs.properties;
  return out;
}

/**
 * Send a chat completion request to OpenAI.
 *
 * @param prompt - The user message/prompt
 * @param options - Completion options
 * @returns The completion result
 */
export async function chatCompletion(
  prompt: string,
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResult> {
  const client = getAIClient();
  const model = options.model ?? getDefaultModel();
  const maxTokens = options.maxTokens ?? getDefaultMaxTokens();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (options.systemMessage) {
    messages.push({
      role: 'system',
      content: options.systemMessage,
    });
  }

  messages.push({
    role: 'user',
    content: prompt,
  });

  try {
    const response = await client.chat.completions.create(
      {
        model,
        // Reasoning models take `max_completion_tokens` + `reasoning_effort`
        // and reject `temperature`; GPT-4 keeps `max_tokens` + `temperature`.
        ...buildSamplingParams({
          model,
          maxTokens,
          temperature: options.temperature,
          reasoningEffort:
            options.reasoningEffort ?? getDefaultReasoningEffort(),
        }),
        messages,
        ...(options.jsonResponse && {
          response_format: { type: 'json_object' },
        }),
        ...(options.seed !== undefined && { seed: options.seed }),
        ...posthogBodyParams(options.observability),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      options.timeoutMs !== undefined || options.maxRetries !== undefined
        ? { timeout: options.timeoutMs, maxRetries: options.maxRetries }
        : undefined
    );

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';

    return {
      content,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  } catch (error) {
    if (isRateLimitError(error)) {
      throw new Error(RATE_LIMIT_MESSAGE);
    }
    throw error;
  }
}

/**
 * Send a chat completion with images (GPT-4 Vision).
 *
 * @param prompt - The user message/prompt
 * @param images - Array of images to analyze
 * @param options - Vision options
 * @returns The completion result
 */
export async function visionCompletion(
  prompt: string,
  images: ImageInput[],
  options: VisionOptions = {}
): Promise<ChatCompletionResult> {
  const client = getAIClient();
  const model = options.model ?? MODELS.vision;
  const maxTokens = options.maxTokens ?? getDefaultMaxTokens();
  const detail = options.detail ?? 'low';

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (options.systemMessage) {
    messages.push({
      role: 'system',
      content: options.systemMessage,
    });
  }

  // Build content array with text and images
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: prompt },
  ];

  for (const image of images) {
    if (image.base64) {
      const mimeType = image.mimeType ?? 'image/jpeg';
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${image.base64}`,
          detail,
        },
      });
    } else if (image.url) {
      content.push({
        type: 'image_url',
        image_url: {
          url: image.url,
          detail,
        },
      });
    }
  }

  messages.push({
    role: 'user',
    content,
  });

  try {
    const response = await client.chat.completions.create(
      {
        model,
        ...buildSamplingParams({
          model,
          maxTokens,
          temperature: options.temperature,
          reasoningEffort:
            options.reasoningEffort ?? getDefaultReasoningEffort(),
        }),
        messages,
        ...(options.jsonResponse && {
          response_format: { type: 'json_object' },
        }),
        ...posthogBodyParams(options.observability),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      options.timeoutMs !== undefined || options.maxRetries !== undefined
        ? { timeout: options.timeoutMs, maxRetries: options.maxRetries }
        : undefined
    );

    const choice = response.choices[0];

    return {
      content: choice?.message?.content ?? '',
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  } catch (error) {
    if (isRateLimitError(error)) {
      throw new Error(RATE_LIMIT_MESSAGE);
    }
    throw error;
  }
}

/**
 * Stream a chat completion response.
 *
 * @param prompt - The user message/prompt
 * @param options - Completion options
 * @yields Chunks of the response
 */
export async function* streamChatCompletion(
  prompt: string,
  options: ChatCompletionOptions = {}
): AsyncGenerator<string, void, unknown> {
  const client = getAIClient();
  const model = options.model ?? getDefaultModel();
  const maxTokens = options.maxTokens ?? getDefaultMaxTokens();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (options.systemMessage) {
    messages.push({
      role: 'system',
      content: options.systemMessage,
    });
  }

  messages.push({
    role: 'user',
    content: prompt,
  });

  // The client-level instrumentation passes streaming calls through untouched
  // (token usage only arrives at stream end), so capture the $ai_generation
  // event here once the stream completes.
  const start = Date.now();
  let assistantText = '';
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  // Cached-prefix and reasoning token counts arrive in the same final usage
  // chunk. Without the cached count PostHog prices every input token at the
  // full rate — a 10x overstatement on GPT-5.x, where cached input is $0.02
  // vs $0.20 per 1M.
  let cachedPromptTokens: number | undefined;
  let reasoningTokens: number | undefined;
  let resolvedModel = model;

  try {
    const stream = await client.chat.completions.create(
      {
        model,
        ...buildSamplingParams({
          model,
          maxTokens,
          temperature: options.temperature,
          reasoningEffort:
            options.reasoningEffort ?? getDefaultReasoningEffort(),
        }),
        messages,
        stream: true,
        // Ask OpenAI to emit a final usage chunk so we can record token counts.
        stream_options: { include_usage: true },
      },
      options.timeoutMs !== undefined
        ? { timeout: options.timeoutMs }
        : undefined
    );

    for await (const chunk of stream) {
      if (chunk.model) resolvedModel = chunk.model as typeof model;
      if (chunk.usage) {
        cachedPromptTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
        reasoningTokens =
          chunk.usage.completion_tokens_details?.reasoning_tokens;
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
      }
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        assistantText += content;
        yield content;
      }
    }

    captureAiGeneration({
      provider: 'openai',
      model: resolvedModel,
      spanName: options.observability?.spanName ?? 'ai.streamChatCompletion',
      distinctId: options.observability?.distinctId,
      traceId: options.observability?.traceId,
      groups: options.observability?.groups,
      input: messages,
      outputChoices: [{ role: 'assistant', content: assistantText }],
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      // OpenAI's cached tokens are a SUBSET of prompt_tokens (inclusive);
      // PostHog auto-detects that from the provider, so report the raw value
      // rather than subtracting it from inputTokens.
      cacheReadInputTokens: cachedPromptTokens,
      latencySeconds: (Date.now() - start) / 1000,
      temperature: options.temperature,
      maxTokens,
      properties: {
        ...options.observability?.properties,
        ...(reasoningTokens !== undefined && { reasoningTokens }),
      },
    });
  } catch (error) {
    captureAiGeneration({
      provider: 'openai',
      model: resolvedModel,
      spanName: options.observability?.spanName ?? 'ai.streamChatCompletion',
      distinctId: options.observability?.distinctId,
      traceId: options.observability?.traceId,
      groups: options.observability?.groups,
      properties: options.observability?.properties,
      input: messages,
      latencySeconds: (Date.now() - start) / 1000,
      isError: true,
      error: error instanceof Error ? error.message : String(error),
    });
    if (isRateLimitError(error)) {
      throw new Error(RATE_LIMIT_MESSAGE);
    }
    throw error;
  }
}
