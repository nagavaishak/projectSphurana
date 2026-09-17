import type Anthropic from '@anthropic-ai/sdk';
import {
  getAnthropicClient,
  getDefaultAnthropicMaxTokens,
  getDefaultAnthropicModel,
} from './anthropic-client.js';
import { RATE_LIMIT_MESSAGE, isRateLimitError } from './errors.js';
import type {
  AnthropicChatCompletionOptions,
  AnthropicChatCompletionResult,
  AnthropicMessage,
  AnthropicTextBlock,
} from './types.js';

type SdkTextBlock = Anthropic.TextBlockParam;
type SdkMessageParam = Anthropic.MessageParam;

function toSdkTextBlock(block: AnthropicTextBlock): SdkTextBlock {
  // `cache_control: { type: 'ephemeral' }` applied on a per-block basis. The
  // SDK only caches blocks that carry the marker — un-marked blocks are
  // variable-per-request.
  const sdkBlock: SdkTextBlock = { type: 'text', text: block.text };
  if (block.cacheControl) {
    sdkBlock.cache_control = { type: 'ephemeral' };
  }
  return sdkBlock;
}

function toSdkMessage(message: AnthropicMessage): SdkMessageParam {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content.map(toSdkTextBlock),
  };
}

/**
 * Send a Claude chat completion request.
 *
 * System prompt must be expressed as an ordered list of text blocks so stable
 * prefix content can carry `cacheControl: true`. Usage metrics surface the
 * cache_creation_input_tokens + cache_read_input_tokens fields so callers can
 * measure cache-hit ratios.
 */
export async function anthropicChatCompletion(
  options: AnthropicChatCompletionOptions
): Promise<AnthropicChatCompletionResult> {
  const client = getAnthropicClient();
  const model = options.model ?? getDefaultAnthropicModel();
  const maxTokens = options.maxTokens ?? getDefaultAnthropicMaxTokens();

  const system = options.systemBlocks?.map(toSdkTextBlock);
  const messages = options.messages.map(toSdkMessage);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: options.temperature,
      system,
      messages,
      stop_sequences: options.stopSequences,
    });

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      content,
      stopReason: response.stop_reason ?? null,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationInputTokens:
          response.usage.cache_creation_input_tokens ?? undefined,
        cacheReadInputTokens:
          response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  } catch (error) {
    if (isRateLimitError(error)) {
      throw new Error(RATE_LIMIT_MESSAGE);
    }
    throw error;
  }
}
