import { afterEach, describe, expect, it, vi } from 'vitest';
import nest from '../../api/nest';
import runtimeConfig from '../../api/runtime-config';

const ENV_KEYS = [
  'VERCEL_ENV',
  'VERCEL_GIT_PULL_REQUEST_ID',
  'PREVIEW_API_ORIGIN',
  'VERCEL_URL',
];
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

const probe = async (env: Record<string, string>) => {
  for (const k of ENV_KEYS) delete process.env[k];
  // The schema-required floor, identical across every case — so the only
  // thing varying between them is the override/PR-number pair under test.
  Object.assign(process.env, {
    API_URL: 'https://api.borradh.io',
    APP_URL: 'https://app.borradh.io',
    POSTHOG_KEY: 'phc_test',
    POSTHOG_HOST: 'https://eu.i.posthog.com',
  });
  Object.assign(process.env, env);

  const cfg = await runtimeConfig(
    new Request('https://x/api/runtime-config')
  ).json();

  // Capture where the proxy would send the request instead of making it.
  let upstream: string | null = null;
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    upstream = String(input instanceof Request ? input.url : input);
    return Promise.resolve(new Response('ok', { status: 200 }));
  });
  const res = await nest(new Request('https://x/api/nest/health'));

  return {
    apiUrl: cfg.apiUrl,
    appEnv: cfg.appEnv,
    nestStatus: res.status,
    upstream,
  };
};

describe('edge functions — override absent = byte-identical behaviour', () => {
  it('production: absolute apiUrl, proxy route 404s', async () => {
    const r = await probe({
      VERCEL_ENV: 'production',
      VERCEL_URL: 'app.borradh.io',
    });
    expect(r.nestStatus).toBe(404);
    expect(r.apiUrl).not.toBe('/api/nest');
    expect(r.upstream).toBeNull();
  });

  it('production IGNORES the override entirely', async () => {
    const r = await probe({
      VERCEL_ENV: 'production',
      VERCEL_URL: 'app.borradh.io',
      PREVIEW_API_ORIGIN: 'https://borradh-api-nightly-99.fly.dev',
    });
    expect(r.nestStatus).toBe(404);
    expect(r.apiUrl).not.toBe('/api/nest');
    expect(r.upstream).toBeNull();
  });

  it('PR preview still derives the PR-numbered backend', async () => {
    const r = await probe({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_PULL_REQUEST_ID: '818',
      VERCEL_URL: 'x.vercel.app',
    });
    expect(r.apiUrl).toBe('/api/nest');
    expect(r.appEnv).toBe('preview');
    expect(r.upstream).toContain('https://borradh-api-pr-818.fly.dev');
  });

  it('empty-string override does NOT beat the PR derivation', async () => {
    const r = await probe({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_PULL_REQUEST_ID: '818',
      PREVIEW_API_ORIGIN: '',
      VERCEL_URL: 'x.vercel.app',
    });
    expect(r.apiUrl).toBe('/api/nest');
    expect(r.upstream).toContain('https://borradh-api-pr-818.fly.dev');
  });

  it('bare preview with neither PR number nor override still 404s', async () => {
    const r = await probe({
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'x.vercel.app',
    });
    expect(r.nestStatus).toBe(404);
    expect(r.upstream).toBeNull();
  });
});

describe('edge functions — the new nightly path', () => {
  it('override on a non-PR preview points the proxy at the ephemeral backend', async () => {
    const r = await probe({
      VERCEL_ENV: 'preview',
      PREVIEW_API_ORIGIN: 'https://borradh-api-nightly-99.fly.dev',
      VERCEL_URL: 'x.vercel.app',
    });
    expect(r.apiUrl).toBe('/api/nest');
    expect(r.appEnv).toBe('preview');
    expect(r.upstream).toContain('https://borradh-api-nightly-99.fly.dev');
  });

  it('a trailing slash on the override does not double up', async () => {
    const r = await probe({
      VERCEL_ENV: 'preview',
      PREVIEW_API_ORIGIN: 'https://borradh-api-nightly-99.fly.dev/',
      VERCEL_URL: 'x.vercel.app',
    });
    expect(r.upstream).not.toContain('.fly.dev//');
    expect(r.upstream).toContain('https://borradh-api-nightly-99.fly.dev');
  });

  it('the override BEATS a PR number when both are set', async () => {
    const r = await probe({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_PULL_REQUEST_ID: '818',
      PREVIEW_API_ORIGIN: 'https://borradh-api-nightly-99.fly.dev',
      VERCEL_URL: 'x.vercel.app',
    });
    expect(r.upstream).toContain('nightly-99');
    expect(r.upstream).not.toContain('pr-818');
  });
});
