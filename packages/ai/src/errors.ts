/**
 * AI Error Utilities
 *
 * Helpers for detecting and classifying OpenAI + Anthropic API errors.
 */

import {
  APIConnectionError as AnthropicAPIConnectionError,
  APIError as AnthropicAPIError,
  InternalServerError as AnthropicInternalServerError,
  RateLimitError as AnthropicRateLimitError,
} from '@anthropic-ai/sdk';
import { APIError, RateLimitError } from 'openai';

/**
 * Check if an error is a rate limit (429) error from either OpenAI or
 * Anthropic.
 *
 * Checks in order:
 * 1. OpenAI SDK's typed RateLimitError class
 * 2. OpenAI APIError with status 429
 * 3. Anthropic SDK's typed RateLimitError class
 * 4. Anthropic APIError with status 429
 * 5. Fallback string matching for wrapped/re-thrown errors
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof APIError && error.status === 429) return true;
  if (error instanceof AnthropicRateLimitError) return true;
  if (error instanceof AnthropicAPIError && error.status === 429) return true;
  if (
    error instanceof Error &&
    (error.message.includes('429') ||
      error.message.toLowerCase().includes('rate limit') ||
      error.message.toLowerCase().includes('quota'))
  ) {
    return true;
  }
  return false;
}

/** User-friendly message for rate limit errors */
export const RATE_LIMIT_MESSAGE =
  'AI service is temporarily busy. Please try again in a moment.';

// ---------------------------------------------------------------------------
// Stream-error classification (used by runToolLoop)
// ---------------------------------------------------------------------------

export interface StreamErrorClassification {
  category: 'transient' | 'terminal' | 'unknown';
  httpStatus?: number;
  apiErrorType?: string;
  message: string;
}

export function classifyStreamError(error: unknown): StreamErrorClassification {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof AnthropicAPIConnectionError) {
    return { category: 'transient', message };
  }

  if (error instanceof AnthropicAPIError) {
    const httpStatus = error.status ?? undefined;
    const apiErrorType =
      (error as AnthropicAPIError & { type?: string }).type ?? undefined;
    const isTransientStatus =
      httpStatus === 408 ||
      httpStatus === 409 ||
      httpStatus === 429 ||
      (typeof httpStatus === 'number' && httpStatus >= 500);
    const isTerminalStatus =
      typeof httpStatus === 'number' &&
      httpStatus >= 400 &&
      httpStatus < 500 &&
      !isTransientStatus;

    if (
      error instanceof AnthropicRateLimitError ||
      error instanceof AnthropicInternalServerError ||
      isTransientStatus ||
      apiErrorType === 'rate_limit_error' ||
      apiErrorType === 'overloaded_error' ||
      apiErrorType === 'timeout_error' ||
      apiErrorType === 'api_error'
    ) {
      return { category: 'transient', httpStatus, apiErrorType, message };
    }

    if (
      isTerminalStatus ||
      apiErrorType === 'billing_error' ||
      apiErrorType === 'authentication_error' ||
      apiErrorType === 'permission_error' ||
      apiErrorType === 'invalid_request_error' ||
      apiErrorType === 'not_found_error'
    ) {
      return { category: 'terminal', httpStatus, apiErrorType, message };
    }

    return { category: 'unknown', httpStatus, apiErrorType, message };
  }

  return { category: 'unknown', message };
}
