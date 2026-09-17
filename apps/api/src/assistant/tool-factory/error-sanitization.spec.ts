import {
  INTERNAL_ERROR_PATTERNS,
  STATUS_MESSAGES,
  sanitizeApiError,
} from './error-sanitization.js';

describe('sanitizeApiError', () => {
  it('replaces SQL leakage with the status-code message', () => {
    const sanitized = sanitizeApiError(
      'failed query: select id from users where email = $1',
      400
    );
    expect(sanitized).toBe(STATUS_MESSAGES[400]);
  });

  it('replaces stack frames with the status-code message', () => {
    const sanitized = sanitizeApiError(
      'crash at AdsService.foo (/src/ads/ads.service.ts:42:10)',
      500
    );
    expect(sanitized).not.toMatch(/ads\.service\.ts/);
  });

  it('replaces postgres / connection errors', () => {
    const sanitized1 = sanitizeApiError('postgres connection lost', 500);
    const sanitized2 = sanitizeApiError('ECONNREFUSED to redis:6379', 500);
    expect(sanitized1).not.toMatch(/postgres/);
    expect(sanitized2).not.toMatch(/redis|ECONNREFUSED/);
  });

  it('replaces token leaks', () => {
    // The pattern `\btoken\b.*=\s*\S+` matches a standalone "token" word
    // followed by a value — the lifted v2 controller's surface.
    const sanitized = sanitizeApiError('Authorization token = abc123', 401);
    expect(sanitized).toBe(STATUS_MESSAGES[401]);
  });

  it('truncates long messages without internal patterns to 200 chars', () => {
    const long = 'a'.repeat(500);
    const sanitized = sanitizeApiError(long, 400);
    expect(sanitized.length).toBe(200);
  });

  it('passes through clean short messages', () => {
    expect(sanitizeApiError('Lead not found', 404)).toBe('Lead not found');
  });

  it('falls back to generic message when status code is unknown', () => {
    const sanitized = sanitizeApiError('drizzle internal error', 599);
    expect(sanitized).toBe('Something went wrong. Please try again.');
  });

  it('exports the patterns for downstream re-use', () => {
    expect(INTERNAL_ERROR_PATTERNS.length).toBeGreaterThan(0);
  });
});
