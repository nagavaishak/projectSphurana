import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchJsonWithRetry,
  fetchWithRetry,
  isTransientHttpError,
} from './fetch-with-retry.js';
import { FetchTimeoutError } from './fetch-with-timeout.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('isTransientHttpError', () => {
  it('treats a timeout as transient', () => {
    expect(isTransientHttpError(new FetchTimeoutError('u', 10))).toBe(true);
  });

  it('treats ECONNRESET (on cause) as transient', () => {
    const err = new Error('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ECONNRESET' };
    expect(isTransientHttpError(err)).toBe(true);
  });

  it('does NOT retry a deliberate caller AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isTransientHttpError(err)).toBe(false);
  });

  it('treats a generic error as non-transient', () => {
    expect(isTransientHttpError(new Error('bad request'))).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  it('returns immediately on a 2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));
    const res = await fetchWithRetry('https://example.com', { retries: 2 });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await fetchWithRetry('https://example.com', {
      retries: 2,
      minDelayMs: 1,
      maxDelayMs: 2,
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 404 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await fetchWithRetry('https://example.com', {
      retries: 3,
      minDelayMs: 1,
    });

    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network error then throws after exhausting retries', async () => {
    const netErr = new Error('fetch failed');
    (netErr as { cause?: unknown }).cause = { code: 'ECONNRESET' };
    const fetchMock = vi.fn().mockRejectedValue(netErr);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      fetchWithRetry('https://example.com', {
        retries: 2,
        minDelayMs: 1,
        maxDelayMs: 2,
      })
    ).rejects.toBe(netErr);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('returns the last retryable response when retries run out', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('busy', { status: 429 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await fetchWithRetry('https://example.com', {
      retries: 1,
      minDelayMs: 1,
      maxDelayMs: 2,
    });

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchJsonWithRetry', () => {
  it('parses JSON on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hello: 'world' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const data = await fetchJsonWithRetry<{ hello: string }>(
      'https://example.com'
    );
    expect(data.hello).toBe('world');
  });

  it('throws on a non-ok final response', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(
      fetchJsonWithRetry('https://example.com', { retries: 0 })
    ).rejects.toThrow(/403/);
  });

  it('scrubs access_token from the thrown error message', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(
      fetchJsonWithRetry(
        'https://graph.facebook.com/v21.0/me?access_token=EAABleaky',
        { retries: 0 }
      )
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes('EAABleaky') &&
        error.message.includes('access_token=REDACTED')
    );
  });
});
