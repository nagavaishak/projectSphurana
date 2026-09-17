import { initAIClient, isAIClientInitialized } from '@borradh-workspace/ai';

/**
 * Lazily initialise the shared OpenAI client before the onboarding services
 * call `extractJson`. Mirrors the per-service init pattern used across the
 * features package (the client is a process-wide singleton — the API doesn't
 * init it at boot). Returns false when no key is configured so callers can
 * fall back gracefully instead of throwing "AI client not initialized".
 */
export function ensureAiClient(): boolean {
  if (isAIClientInitialized()) return true;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return false;
  initAIClient({ apiKey });
  return true;
}
