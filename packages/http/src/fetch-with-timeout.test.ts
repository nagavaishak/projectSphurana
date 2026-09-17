import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FetchTimeoutError,
  fetchWithTimeout,
  redactUrlSecrets,
} from './fetch-with-timeout.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fetchWithTimeout', () => {
  it('returns the response when fetch resolves in time', async () => {
    const response = new Response('ok');
    globalThis.fetch = vi.fn().mockResolvedValue(response);

    const result = await fetchWithTimeout('https://example.com', {
      timeoutMs: 1000,
    });

    expect(result).toBe(response);
  });

  it('throws FetchTimeoutError when the request exceeds the timeout', async () => {
    // Simulate a fetch that only rejects once its signal aborts.
    globalThis.fetch = vi.fn((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof fetch;

    await expect(
      fetchWithTimeout('https://example.com', { timeoutMs: 10 })
    ).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it('propagates a non-timeout fetch error unchanged', async () => {
    const boom = new Error('boom');
    globalThis.fetch = vi.fn().mockRejectedValue(boom);

    await expect(
      fetchWithTimeout('https://example.com', { timeoutMs: 1000 })
    ).rejects.toBe(boom);
  });

  it('aborts when the caller signal aborts', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof fetch;

    const promise = fetchWithTimeout('https://example.com', {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort();

    // Caller-initiated abort surfaces as a plain AbortError, not a timeout.
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('redactUrlSecrets', () => {
  it('redacts access_token from a query string', () => {
    expect(
      redactUrlSecrets(
        'https://graph.facebook.com/v21.0/me?access_token=EAAB123secret'
      )
    ).toBe('https://graph.facebook.com/v21.0/me?access_token=REDACTED');
  });

  it('redacts appsecret_proof and preserves other params', () => {
    expect(
      redactUrlSecrets(
        'https://graph.facebook.com/v21.0/me?fields=id&access_token=tok&appsecret_proof=abc123&limit=50'
      )
    ).toBe(
      'https://graph.facebook.com/v21.0/me?fields=id&access_token=REDACTED&appsecret_proof=REDACTED&limit=50'
    );
  });

  it('is case-insensitive and leaves secret-free URLs unchanged', () => {
    expect(redactUrlSecrets('https://example.com/a?ACCESS_TOKEN=x')).toBe(
      'https://example.com/a?ACCESS_TOKEN=REDACTED'
    );
    expect(redactUrlSecrets('https://example.com/a?foo=bar')).toBe(
      'https://example.com/a?foo=bar'
    );
  });
});

describe('FetchTimeoutError scrubbing', () => {
  it('redacts access_token from both message and url property', () => {
    const error = new FetchTimeoutError(
      'https://graph.facebook.com/v21.0/12345?fields=id&access_token=EAABsecret',
      15_000
    );
    expect(error.message).not.toContain('EAABsecret');
    expect(error.url).not.toContain('EAABsecret');
    expect(error.message).toContain('access_token=REDACTED');
    expect(error.url).toContain('access_token=REDACTED');
  });

  it('a timed-out fetch surfaces a scrubbed URL', async () => {
    globalThis.fetch = vi.fn((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof fetch;

    await expect(
      fetchWithTimeout('https://example.com/x?access_token=supersecret', {
        timeoutMs: 10,
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof FetchTimeoutError &&
        !error.message.includes('supersecret') &&
        !error.url.includes('supersecret')
    );
  });
});
