/**
 * Canonical model choices, by task tier.
 *
 * Before this existed, ~15 services each declared their own
 * `const AI_MODEL = 'gpt-4o'` and another ~10 passed a `defaultModel` inline to
 * `initAIClient`. Changing model generation meant a sweep across every one of
 * them — which is exactly the migration this map is meant to be the last of.
 *
 * Pick a TIER here, not a model id. If a call site genuinely needs a specific
 * model (an eval pinning a snapshot, a capability only one model has), pass the
 * id explicitly at the call site and leave a comment saying why.
 */

import type { AIModel } from './types.js';

export const MODELS = {
  /**
   * General-purpose text generation: chatbot replies, copy generation,
   * summarization, structured extraction.
   *
   * gpt-5.6-luna at $0.20/$1.20 per 1M is ~12x cheaper than gpt-4o
   * ($2.50/$10.00) and materially stronger, so there is no tier below this
   * worth maintaining — `cheap` deliberately points at the same model.
   */
  chat: 'gpt-5.6-luna',

  /**
   * High-volume, low-stakes calls (classification, title generation, CSV field
   * normalization). Same model as `chat` today; kept as a distinct name so the
   * tiers can diverge later without another call-site sweep.
   */
  cheap: 'gpt-5.6-luna',

  /**
   * Image understanding (`visionCompletion`). Same family — the GPT-5.6 models
   * are natively multimodal on input.
   */
  vision: 'gpt-5.6-luna',
} as const satisfies Record<string, AIModel>;

export type ModelTier = keyof typeof MODELS;
