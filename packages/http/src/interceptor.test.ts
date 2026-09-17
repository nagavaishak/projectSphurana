import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchTimeoutError, fetchWithTimeout } from './fetch-with-timeout.js';
import {
  type FetchInterceptor,
  getFetchInterceptor,
  hasFetchInterceptor,
  setFetchInterceptor,
} from './interceptor.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  setFetchInterceptor(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('setFetchInterceptor', () => {
  it('is unset by default and reports so', () => {
    expect(getFetchInterceptor()).toBeNull();
    expect(hasFetchInterceptor()).toBe(false);
  });

  it('returns the previous interceptor so tests can restore it', () => {
    const a: FetchInterceptor = async () => null;
    const b: FetchInterceptor = async () => null;

    expect(setFetchInterceptor(a)).toBeNull();
    expect(setFetchInterceptor(b)).toBe(a);
    expect(getFetchInterceptor()).toBe(b);
  });
});

describe('fetchWithTimeout + interceptor', () => {
  it('does not touch the network when no interceptor is installed', async () => {
    const realFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', realFetch);

    await fetchWithTimeout('https://example.com/thing');

    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  it('serves the intercepted response and never calls fetch', async () => {
    const realFetch = vi.fn();
    vi.stubGlobal('fetch', realFetch);
    setFetchInterceptor(async () => jsonResponse({ id: 'stub-1' }));

    const res = await fetchWithTimeout('https://graph.facebook.com/v21.0/me');

    expect(await res.json()).toEqual({ id: 'stub-1' });
    expect(realFetch).not.toHaveBeenCalled();
  });

  it('passes through to the network when the interceptor returns null', async () => {
    // This is what keeps a Meta-only fake from swallowing S3/CDN/OpenAI traffic.
    const realFetch = vi.fn().mockResolvedValue(jsonResponse({ real: true }));
    vi.stubGlobal('fetch', realFetch);

    const seen: string[] = [];
    setFetchInterceptor(async (url) => {
      seen.push(url);
      return url.includes('graph.facebook.com') ? jsonResponse({}) : null;
    });

    const res = await fetchWithTimeout('https://s3.amazonaws.com/bucket/key');

    expect(await res.json()).toEqual({ real: true });
    expect(realFetch).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['https://s3.amazonaws.com/bucket/key']);
  });

  it('propagates an interceptor throw to the caller', async () => {
    // The fake relies on this: "unknown Graph endpoint" and request-contract
    // violations must surface immediately, not as a downstream timeout.
    vi.stubGlobal('fetch', vi.fn());
    setFetchInterceptor(async () => {
      throw new Error('unknown Graph endpoint: POST /act_1/foo');
    });

    await expect(
      fetchWithTimeout('https://graph.facebook.com/x')
    ).rejects.toThrow('unknown Graph endpoint');
  });

  it('receives the request init, including method and body', async () => {
    vi.stubGlobal('fetch', vi.fn());
    let capturedInit: RequestInit | undefined;
    setFetchInterceptor(async (_url, init) => {
      capturedInit = init;
      return jsonResponse({});
    });

    await fetchWithTimeout('https://graph.facebook.com/v21.0/act_1/ads', {
      method: 'POST',
      body: JSON.stringify({ name: 'E2E ad' }),
    });

    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      name: 'E2E ad',
    });
  });

  it('times out a hanging interceptor instead of wedging the caller', async () => {
    // A buggy interceptor must fail like a slow upstream. Without the
    // abort race, this would hang forever and take a worker with it.
    vi.stubGlobal('fetch', vi.fn());
    setFetchInterceptor(() => new Promise<Response>(() => undefined));

    await expect(
      fetchWithTimeout('https://graph.facebook.com/v21.0/me', { timeoutMs: 20 })
    ).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it('gives the interceptor a signal that aborts on timeout', async () => {
    vi.stubGlobal('fetch', vi.fn());
    let aborted = false;
    setFetchInterceptor(
      (_url, init) =>
        new Promise<Response>(() => {
          init.signal?.addEventListener('abort', () => {
            aborted = true;
          });
        })
    );

    await expect(
      fetchWithTimeout('https://graph.facebook.com/v21.0/me', { timeoutMs: 20 })
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(aborted).toBe(true);
  });
});
