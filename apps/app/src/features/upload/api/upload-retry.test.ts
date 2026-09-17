import { describe, expect, it } from 'vitest';

import {
  PRESIGN_REFRESH_MARGIN_SECONDS,
  RetryableUploadError,
  StaleUrlUploadError,
  backoffWithJitter,
  classifyUploadHttpFailure,
  isRetryableUploadError,
  needsFreshUrl,
  shouldRefreshPresignedUrl,
} from './upload-retry';

describe('classifyUploadHttpFailure', () => {
  it('classifies 403 as retryable-with-refresh (stale presigned URL)', () => {
    const error = classifyUploadHttpFailure(403);
    expect(error).toBeInstanceOf(StaleUrlUploadError);
    expect(error).toBeInstanceOf(RetryableUploadError);
    expect(isRetryableUploadError(error)).toBe(true);
    expect(needsFreshUrl(error)).toBe(true);
  });

  it('classifies 5xx as retryable without refresh', () => {
    for (const status of [500, 502, 503]) {
      const error = classifyUploadHttpFailure(status);
      expect(error).toBeInstanceOf(RetryableUploadError);
      expect(error).not.toBeInstanceOf(StaleUrlUploadError);
      expect(isRetryableUploadError(error)).toBe(true);
      expect(needsFreshUrl(error)).toBe(false);
    }
  });

  it('classifies other 4xx as permanent', () => {
    for (const status of [400, 404, 413]) {
      const error = classifyUploadHttpFailure(status);
      expect(isRetryableUploadError(error)).toBe(false);
      expect(needsFreshUrl(error)).toBe(false);
    }
  });
});

describe('isRetryableUploadError', () => {
  it('treats network TypeErrors as retryable', () => {
    expect(isRetryableUploadError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('treats plain errors as not retryable', () => {
    expect(isRetryableUploadError(new Error('Upload aborted'))).toBe(false);
    expect(isRetryableUploadError('oops')).toBe(false);
  });
});

describe('backoffWithJitter', () => {
  it('returns a delay within [0, base] for the attempt', () => {
    const bases = [1000, 2000, 4000, 8000];
    for (let attempt = 1; attempt <= bases.length; attempt++) {
      for (let i = 0; i < 20; i++) {
        const delay = backoffWithJitter(attempt, bases);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(bases[attempt - 1]);
      }
    }
  });

  it('falls back to the last base when attempts exceed the table', () => {
    const delay = backoffWithJitter(10, [1000, 2000]);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(2000);
  });
});

describe('shouldRefreshPresignedUrl', () => {
  const issuedAt = 1_000_000;

  it('does not refresh a freshly issued URL', () => {
    expect(shouldRefreshPresignedUrl(issuedAt, 900, issuedAt)).toBe(false);
    expect(shouldRefreshPresignedUrl(issuedAt, 900, issuedAt + 60_000)).toBe(
      false
    );
  });

  it('refreshes once within the safety margin of expiry', () => {
    const expiresIn = 900; // 15 min TTL
    const usableMs = (expiresIn - PRESIGN_REFRESH_MARGIN_SECONDS) * 1000;
    expect(
      shouldRefreshPresignedUrl(issuedAt, expiresIn, issuedAt + usableMs - 1)
    ).toBe(false);
    expect(
      shouldRefreshPresignedUrl(issuedAt, expiresIn, issuedAt + usableMs)
    ).toBe(true);
  });

  it('refreshes immediately when the TTL is shorter than the margin', () => {
    expect(shouldRefreshPresignedUrl(issuedAt, 30, issuedAt)).toBe(true);
  });
});
