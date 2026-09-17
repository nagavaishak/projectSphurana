import { afterEach, describe, expect, it } from 'vitest';

import { debugRouteDisabledResponse, debugRoutesEnabled } from './debug-routes';

const ORIGINAL = { ...process.env };

// Each case REPLACES process.env rather than deleting keys from it. Assigning
// `undefined` to a process.env key does not unset it — Node coerces the value
// to the string "undefined", which every check here would then read as set.
function withEnv(overrides: Record<string, string>) {
  const { DEBUG_ENDPOINTS_ENABLED, PUBLIC_APP_ENV, VERCEL_ENV, ...rest } =
    ORIGINAL;
  process.env = { ...rest, ...overrides };
}

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('debugRoutesEnabled', () => {
  it('is off when the flag is unset, even on a preview', () => {
    withEnv({ VERCEL_ENV: 'preview' });

    // This is the tier that was missing: the routes were reachable on every
    // preview simply because nobody had set anything, and a public forced
    // error is what Sentry MARKETING-4 actually was.
    expect(debugRoutesEnabled()).toBe(false);
  });

  it.each(['false', '0', 'no', '', 'FALSE '])(
    'stays off for DEBUG_ENDPOINTS_ENABLED=%j',
    (value) => {
      withEnv({ DEBUG_ENDPOINTS_ENABLED: value, VERCEL_ENV: 'preview' });

      // `Boolean(string)` would read "false" and "0" as ON. A flag guarding
      // error injection must not inherit that trap.
      expect(debugRoutesEnabled()).toBe(false);
    }
  );

  it.each(['true', 'TRUE', ' true ', '1'])(
    'turns on for DEBUG_ENDPOINTS_ENABLED=%j outside production',
    (value) => {
      withEnv({ DEBUG_ENDPOINTS_ENABLED: value, VERCEL_ENV: 'preview' });

      expect(debugRoutesEnabled()).toBe(true);
    }
  );

  it('is on for local dev with the flag', () => {
    withEnv({ DEBUG_ENDPOINTS_ENABLED: 'true', PUBLIC_APP_ENV: 'development' });

    expect(debugRoutesEnabled()).toBe(true);
  });

  it('stays off on production no matter what the flag says', () => {
    withEnv({ DEBUG_ENDPOINTS_ENABLED: 'true', PUBLIC_APP_ENV: 'production' });

    expect(debugRoutesEnabled()).toBe(false);
  });

  it('stays off on a Vercel production deployment', () => {
    // No PUBLIC_APP_ENV is configured on this project's Vercel setup, so
    // VERCEL_ENV is what actually decides — see resolveAppEnv.
    withEnv({ DEBUG_ENDPOINTS_ENABLED: 'true', VERCEL_ENV: 'production' });

    expect(debugRoutesEnabled()).toBe(false);
  });

  it('defaults to production when the environment says nothing', () => {
    withEnv({ DEBUG_ENDPOINTS_ENABLED: 'true' });

    expect(debugRoutesEnabled()).toBe(false);
  });
});

describe('debugRouteDisabledResponse', () => {
  it('404s rather than 403s, so the route looks absent', async () => {
    const res = debugRouteDisabledResponse();

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });
});
