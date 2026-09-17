import OpenAI from 'openai';
import { instrumentOpenAI } from './instrument.js';
import { MODELS } from './models.js';
import type { AIClientConfig, AIModel, ReasoningEffort } from './types.js';

let client: OpenAI | null = null;
let config: AIClientConfig | null = null;

/**
 * Initialize the AI client with configuration.
 * Must be called before using any AI functions.
 *
 * @param clientConfig - API key and optional settings
 */
export function initAIClient(clientConfig: AIClientConfig): void {
  config = clientConfig;
  client = instrumentOpenAI(
    new OpenAI({
      apiKey: clientConfig.apiKey,
      organization: clientConfig.organization,
      maxRetries: 3,
      // Bound every request so a stuck completion can't hang the process. The
      // SDK default is 10 minutes; 60s is ample for chat/vision calls. Per-call
      // overrides are passed at the call site.
      timeout: clientConfig.timeoutMs ?? 60_000,
    })
  );
}

/**
 * Get the OpenAI client instance.
 * Throws if not initialized.
 */
export function getAIClient(): OpenAI {
  if (!client) {
    throw new Error('AI client not initialized. Call initAIClient first.');
  }
  return client;
}

/**
 * Get the AI client configuration.
 */
export function getAIConfig(): AIClientConfig | null {
  return config;
}

/**
 * Check if the AI client is initialized.
 */
export function isAIClientInitialized(): boolean {
  return client !== null && config !== null;
}

/**
 * Get the default model from config or fallback.
 */
export function getDefaultModel(): AIModel {
  return config?.defaultModel ?? MODELS.chat;
}

/**
 * Get the default reasoning effort from config or fallback.
 *
 * `low` keeps GPT-5.x latency close to the GPT-4 era while still buying the
 * reasoning quality the migration is for. Callers that attach function tools
 * on Chat Completions MUST override this to `none` — the API rejects tools at
 * any other effort level.
 */
export function getDefaultReasoningEffort(): ReasoningEffort {
  return config?.defaultReasoningEffort ?? 'low';
}

/**
 * Get the default max tokens from config or fallback.
 */
export function getDefaultMaxTokens(): number {
  return config?.defaultMaxTokens ?? 1500;
}

/**
 * Reset the client (useful for testing).
 */
export function resetAIClient(): void {
  client = null;
  config = null;
}

/**
 * Create a new AI client without affecting the singleton.
 * Useful when you need a separate client with different config.
 */
export function createAIClient(clientConfig: AIClientConfig): OpenAI {
  return instrumentOpenAI(
    new OpenAI({
      apiKey: clientConfig.apiKey,
      organization: clientConfig.organization,
      maxRetries: 3,
      // Bound every request so a stuck completion can't hang the process. The
      // SDK default is 10 minutes; 60s is ample for chat/vision calls. Per-call
      // overrides are passed at the call site.
      timeout: clientConfig.timeoutMs ?? 60_000,
    })
  );
}
