/**
 * Model-aware request parameters.
 *
 * The GPT-5.x family are reasoning models and reject the sampling parameters
 * the GPT-4 family required. On Chat Completions they:
 *
 *   - take `max_completion_tokens`, NOT `max_tokens` (hard 400 otherwise);
 *   - reject `temperature` / `top_p` / the penalty params outright;
 *   - accept `reasoning_effort` — `none | low | medium | high | xhigh | max`.
 *
 * Callers across the workspace pass `{ maxTokens, temperature }` written for
 * GPT-4. Rather than rewrite every call site (and re-break it on the next
 * model generation), `buildSamplingParams` translates that intent into
 * whatever the target model actually accepts, and drops what it doesn't.
 */

import type { AIModel, ReasoningEffort } from './types.js';

/**
 * Model-id prefixes that identify a reasoning model. Matched as prefixes so
 * dated snapshots (`gpt-5.6-luna-2026-07-09`) and future point releases are
 * covered without a new entry here.
 */
const REASONING_MODEL_PREFIXES = ['gpt-5', 'o1', 'o3', 'o4'] as const;

/** Whether `model` is a reasoning model (GPT-5.x / o-series). */
export function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
}

/**
 * Extra `max_completion_tokens` budget, per effort level, to cover reasoning
 * tokens.
 *
 * This is the subtle trap in the migration: on GPT-4, `max_tokens` bounded the
 * VISIBLE answer. On a reasoning model, `max_completion_tokens` bounds
 * reasoning tokens AND the answer together. Passing a call site's existing
 * budget through unchanged (the chatbot's is 1000) lets reasoning consume the
 * whole allowance, and the request returns `finish_reason: 'length'` with
 * EMPTY content — a silent blank reply, not an error.
 *
 * So we add headroom sized to the effort level and leave the caller's number
 * to mean what it always meant: room for the visible answer.
 */
const REASONING_HEADROOM_TOKENS: Record<ReasoningEffort, number> = {
  none: 0,
  low: 2_000,
  medium: 6_000,
  high: 16_000,
  xhigh: 32_000,
  max: 32_000,
};

export interface SamplingParamsInput {
  model: AIModel | string;
  /** Caller's budget for the VISIBLE answer, in tokens. */
  maxTokens: number;
  /** GPT-4-era sampling temperature. Dropped for reasoning models. */
  temperature?: number;
  /** Reasoning effort. Ignored by non-reasoning models. */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Translate GPT-4-shaped intent into the parameters `model` accepts.
 *
 * Reasoning models get `max_completion_tokens` (caller budget + reasoning
 * headroom) and `reasoning_effort`; `temperature` is omitted because the API
 * rejects it. Everything else keeps the classic `max_tokens` + `temperature`.
 */
export function buildSamplingParams(
  input: SamplingParamsInput
): Record<string, unknown> {
  const { model, maxTokens, temperature, reasoningEffort } = input;

  if (!isReasoningModel(model)) {
    return {
      max_tokens: maxTokens,
      ...(temperature !== undefined && { temperature }),
    };
  }

  const effort: ReasoningEffort = reasoningEffort ?? 'low';
  return {
    max_completion_tokens: maxTokens + REASONING_HEADROOM_TOKENS[effort],
    reasoning_effort: effort,
  };
}
