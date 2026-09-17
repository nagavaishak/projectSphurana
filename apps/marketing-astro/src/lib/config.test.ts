import { afterEach, describe, expect, it } from 'vitest';

import { resolveUpstreamApiUrl } from './config';

const ORIGINAL = { ...process.env };

// Each case REPLACES process.env rather than deleting keys from it. Assigning
// `undefined` to a process.env key does not unset it — Node coerces the value
// to the string "undefined", which every check here would then read as set.
function withEnv(overrides: Record<string, string>) {
  const { VERCEL_ENV, VERCEL_GIT_PULL_REQUEST_ID, API_URL, ...rest } = ORIGINAL;
  process.env = { ...rest, ...overrides };
}

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('resolveUpstreamApiUrl', () => {
  it('derives the per-PR Fly app on previews', () => {
    withEnv({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_PULL_REQUEST_ID: '855',
      API_URL: 'https://api.borradh.io',
    });

    // The derived per-PR API WINS over any configured API_URL — a preview must
    // never talk to the production API.
    expect(resolveUpstreamApiUrl()).toBe('https://borradh-api-pr-855.fly.dev');
  });

  it('falls back to API_URL on a branch preview with no open PR', () => {
    withEnv({ VERCEL_ENV: 'preview', API_URL: 'https://api.borradh.io' });

    expect(resolveUpstreamApiUrl()).toBe('https://api.borradh.io');
  });

  it('uses the configured API_URL in production', () => {
    withEnv({
      VERCEL_ENV: 'production',
      VERCEL_GIT_PULL_REQUEST_ID: '855',
      API_URL: 'https://api.borradh.io',
    });

    // A PR id is present on some production deploys too; it must be ignored
    // outside preview, or prod would proxy to a dead Fly app.
    expect(resolveUpstreamApiUrl()).toBe('https://api.borradh.io');
  });

  it('returns empty when nothing is configured, so the proxy 503s loudly', () => {
    withEnv({});

    expect(resolveUpstreamApiUrl()).toBe('');
  });
});
