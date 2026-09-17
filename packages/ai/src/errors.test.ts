import {
  APIConnectionError as AnthropicAPIConnectionError,
  APIError as AnthropicAPIError,
  AuthenticationError as AnthropicAuthenticationError,
  BadRequestError as AnthropicBadRequestError,
  InternalServerError as AnthropicInternalServerError,
  PermissionDeniedError as AnthropicPermissionDeniedError,
  RateLimitError as AnthropicRateLimitError,
} from '@anthropic-ai/sdk';
import { APIError, RateLimitError } from 'openai';
import { describe, expect, it } from 'vitest';
import {
  RATE_LIMIT_MESSAGE,
  classifyStreamError,
  isRateLimitError,
} from './errors.js';

describe('isRateLimitError', () => {
  it('returns true for RateLimitError instance', () => {
    const err = new RateLimitError(
      429,
      { message: 'Rate limited' },
      'Rate limited',
      {}
    );
    expect(isRateLimitError(err)).toBe(true);
  });

  it('returns true for APIError with status 429', () => {
    const err = new APIError(
      429,
      { message: 'Too many requests' },
      'Too many requests',
      {}
    );
    expect(isRateLimitError(err)).toBe(true);
  });

  it('returns true for generic Error with "429" in message', () => {
    const err = new Error('Request failed with status 429');
    expect(isRateLimitError(err)).toBe(true);
  });

  it('returns true for generic Error with "rate limit" in message', () => {
    const err = new Error('You have been rate limited');
    expect(isRateLimitError(err)).toBe(true);
  });

  it('returns true for generic Error with "Rate Limit" (case-insensitive)', () => {
    const err = new Error('Rate Limit exceeded');
    expect(isRateLimitError(err)).toBe(true);
  });

  it('returns true for generic Error with "quota" in message', () => {
    const err = new Error('You exceeded your quota');
    expect(isRateLimitError(err)).toBe(true);
  });

  it('returns false for generic Error without rate limit indicators', () => {
    const err = new Error('Something went wrong');
    expect(isRateLimitError(err)).toBe(false);
  });

  it('returns false for APIError with non-429 status', () => {
    const err = new APIError(
      500,
      { message: 'Internal server error' },
      'Internal server error',
      {}
    );
    expect(isRateLimitError(err)).toBe(false);
  });

  it('returns true for Anthropic RateLimitError instance', () => {
    // Anthropic's APIError constructor requires headers-like object with .get();
    // use a Headers instance for a faithful stand-in.
    const err = new AnthropicRateLimitError(
      429,
      { message: 'Rate limited' },
      'Rate limited',
      new Headers()
    );
    expect(isRateLimitError(err)).toBe(true);
  });

  it('returns true for Anthropic APIError with status 429', () => {
    const err = new AnthropicAPIError(
      429,
      { message: 'Too many requests' },
      'Too many requests',
      new Headers()
    );
    expect(isRateLimitError(err)).toBe(true);
  });

  it('returns false for Anthropic APIError with non-429 status', () => {
    const err = new AnthropicAPIError(
      500,
      { message: 'Internal server error' },
      'Internal server error',
      new Headers()
    );
    expect(isRateLimitError(err)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isRateLimitError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRateLimitError(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isRateLimitError('429 rate limit')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isRateLimitError(429)).toBe(false);
  });
});

describe('RATE_LIMIT_MESSAGE', () => {
  it('is a non-empty string', () => {
    expect(typeof RATE_LIMIT_MESSAGE).toBe('string');
    expect(RATE_LIMIT_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe('classifyStreamError', () => {
  it('classifies RateLimitError as transient', () => {
    const err = new AnthropicRateLimitError(
      429,
      { error: { type: 'rate_limit_error', message: 'Rate limited' } },
      'Rate limited',
      new Headers()
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('transient');
    expect(result.httpStatus).toBe(429);
  });

  it('classifies InternalServerError as transient', () => {
    const err = new AnthropicInternalServerError(
      529,
      { error: { type: 'api_error', message: 'Overloaded' } },
      'Overloaded',
      new Headers()
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('transient');
    expect(result.httpStatus).toBe(529);
  });

  it('classifies APIConnectionError as transient (no httpStatus)', () => {
    const err = new AnthropicAPIConnectionError({
      cause: new Error('ECONNREFUSED'),
    });
    const result = classifyStreamError(err);
    expect(result.category).toBe('transient');
    expect(result.httpStatus).toBeUndefined();
  });

  it('classifies overloaded_error apiErrorType as transient', () => {
    const err = Object.assign(
      new AnthropicAPIError(503, undefined, 'Overloaded', new Headers()),
      { type: 'overloaded_error' }
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('transient');
    expect(result.apiErrorType).toBe('overloaded_error');
  });

  it('classifies timeout_error apiErrorType as transient', () => {
    const err = Object.assign(
      new AnthropicAPIError(408, undefined, 'Timeout', new Headers()),
      { type: 'timeout_error' }
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('transient');
    expect(result.apiErrorType).toBe('timeout_error');
  });

  it('classifies generic 5xx APIError as transient', () => {
    const err = new AnthropicAPIError(
      503,
      { error: { type: 'api_error', message: 'Unavailable' } },
      'Unavailable',
      new Headers()
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('transient');
    expect(result.httpStatus).toBe(503);
  });

  it('classifies AuthenticationError as terminal', () => {
    const err = new AnthropicAuthenticationError(
      401,
      { error: { type: 'authentication_error', message: 'Invalid key' } },
      'Invalid key',
      new Headers()
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('terminal');
    expect(result.httpStatus).toBe(401);
  });

  it('classifies PermissionDeniedError as terminal', () => {
    const err = new AnthropicPermissionDeniedError(
      403,
      { error: { type: 'permission_error', message: 'Denied' } },
      'Denied',
      new Headers()
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('terminal');
    expect(result.httpStatus).toBe(403);
  });

  it('classifies BadRequestError as terminal', () => {
    const err = new AnthropicBadRequestError(
      400,
      { error: { type: 'invalid_request_error', message: 'Bad request' } },
      'Bad request',
      new Headers()
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('terminal');
    expect(result.httpStatus).toBe(400);
  });

  it('classifies billing_error apiErrorType as terminal', () => {
    const err = Object.assign(
      new AnthropicAPIError(402, undefined, 'Billing', new Headers()),
      { type: 'billing_error' }
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('terminal');
    expect(result.apiErrorType).toBe('billing_error');
  });

  it('classifies generic Error as unknown', () => {
    const result = classifyStreamError(new Error('something'));
    expect(result.category).toBe('unknown');
    expect(result.httpStatus).toBeUndefined();
  });

  it('classifies non-Error value as unknown', () => {
    const result = classifyStreamError('a string');
    expect(result.category).toBe('unknown');
    expect(result.message).toBe('a string');
  });

  it('classifies non-retryable 4xx APIError as terminal', () => {
    const err = new AnthropicAPIError(
      418,
      { error: { type: 'not_found_error', message: 'Not found' } },
      'Not found',
      new Headers()
    );
    const result = classifyStreamError(err);
    expect(result.category).toBe('terminal');
    expect(result.httpStatus).toBe(418);
  });

  it('preserves error message from original error', () => {
    const err = new AnthropicRateLimitError(
      429,
      { error: { type: 'rate_limit_error', message: 'Rate limited' } },
      'You have been rate limited',
      new Headers()
    );
    const result = classifyStreamError(err);
    expect(result.message).toContain('Rate limited');
  });
});
