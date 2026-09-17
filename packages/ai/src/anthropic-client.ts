import Anthropic from '@anthropic-ai/sdk';
import { instrumentAnthropic } from './instrument.js';
import type { AnthropicClientConfig, AnthropicModel } from './types.js';

let client: Anthropic | null = null;
let config: AnthropicClientConfig | null = null;

/**
 * Initialize the Anthropic client singleton.
 *
 * Mirrors `initAIClient` (OpenAI) so consumers can pick the same shape.
 * Call once at application startup.
 */
export function initAnthropicClient(clientConfig: AnthropicClientConfig): void {
  config = clientConfig;
  client = instrumentAnthropic(
    new Anthropic({
      apiKey: clientConfig.apiKey,
      maxRetries: clientConfig.maxRetries ?? 3,
      ...(clientConfig.baseURL ? { baseURL: clientConfig.baseURL } : {}),
    })
  );
}

/**
 * Get the Anthropic client singleton. Throws if not initialized.
 */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    throw new Error(
      'Anthropic client not initialized. Call initAnthropicClient first.'
    );
  }
  return client;
}

export function getAnthropicConfig(): AnthropicClientConfig | null {
  return config;
}

export function isAnthropicClientInitialized(): boolean {
  return client !== null && config !== null;
}

export function getDefaultAnthropicModel(): AnthropicModel {
  return config?.defaultModel ?? 'claude-sonnet-4-6';
}

export function getDefaultAnthropicMaxTokens(): number {
  return config?.defaultMaxTokens ?? 4096;
}

/**
 * Reset the Anthropic singleton (useful for tests).
 */
export function resetAnthropicClient(): void {
  client = null;
  config = null;
}

/**
 * Create a new Anthropic client without affecting the singleton.
 *
 * If no apiKey is provided, falls back to `process.env.ANTHROPIC_API_KEY`.
 * Throws if no key is available either way.
 *
 * Useful when callers (e.g. tools, services) want a one-off client and the
 * singleton is owned by a different bootstrap path.
 */
export function createAnthropicClient(apiKey?: string): Anthropic {
  const resolvedKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!resolvedKey) {
    throw new Error(
      'createAnthropicClient: no API key provided and ANTHROPIC_API_KEY is not set'
    );
  }
  return instrumentAnthropic(
    new Anthropic({ apiKey: resolvedKey, maxRetries: 3 })
  );
}
