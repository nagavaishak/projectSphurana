import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Isolation note (isolate: false):
// `@borradh-workspace/env/api` is canonically aliased in vite.config.ts. A
// hoisted per-file `vi.mock('@borradh-workspace/env/api', ...)` installs into
// the SHARED module registry and races with whichever file loads the env
// module first. This test needs to toggle `TURNSTILE_SECRET_KEY` between
// set/unset, which the static canonical mock cannot express, so we register a
// scoped override with `vi.doMock` (non-hoisted) + `vi.resetModules()` + a
// dynamic `import()` of the service inside `beforeEach`. The dynamic getter
// reads `__TEST_TURNSTILE_KEY` so individual tests can flip the value.
// ---------------------------------------------------------------------------

let verifyCaptcha: typeof import('./verify-captcha.service.js').verifyCaptcha;

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('verifyCaptcha', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).__TEST_TURNSTILE_KEY =
      'test-secret-key';

    vi.doMock('@borradh-workspace/env/api', () => ({
      apiEnv: {
        get TURNSTILE_SECRET_KEY() {
          return (globalThis as Record<string, unknown>).__TEST_TURNSTILE_KEY as
            | string
            | undefined;
        },
        NODE_ENV: 'development',
      },
    }));

    ({ verifyCaptcha } = await import('./verify-captcha.service.js'));
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).__TEST_TURNSTILE_KEY = undefined;
    vi.doUnmock('@borradh-workspace/env/api');
    vi.resetModules();
  });

  it('should return true when verification succeeds', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ success: true }),
    });

    const result = await verifyCaptcha('valid-token');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    );
  });

  it('should return false when verification fails', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ success: false }),
    });

    const result = await verifyCaptcha('invalid-token');

    expect(result).toBe(false);
  });

  it('should skip verification and return true when no secret key is configured', async () => {
    (globalThis as Record<string, unknown>).__TEST_TURNSTILE_KEY = undefined;

    const result = await verifyCaptcha('any-token');

    expect(result).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return false on network error (fail closed)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await verifyCaptcha('some-token');

    expect(result).toBe(false);
  });
});
