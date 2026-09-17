import { test } from '@playwright/test';
import { ASSISTANT_UNAVAILABLE } from './seed.fixture.js';

/**
 * The assistant (Claire) testing endpoint runs a real Anthropic model call
 * server-side. On environments where the API has no model key configured it
 * reports "Anthropic API key not configured", which `SeedHelper.
 * simulateAssistantMessage` re-throws prefixed with `ASSISTANT_UNAVAILABLE`.
 *
 * That's an unavailable external dependency, not a test regression — so skip
 * the test cleanly (mirrors `skipIfMetaRateLimited`). Wrap any
 * `simulateAssistantMessage` call site with this so the suite no-ops where the
 * model key is absent and still runs everywhere it's present.
 */
export function skipIfAssistantUnavailable(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(ASSISTANT_UNAVAILABLE)) {
    test.skip(
      true,
      'Assistant model key not configured on this API — skipping LLM turn'
    );
  }
  throw error instanceof Error ? error : new Error(message);
}
