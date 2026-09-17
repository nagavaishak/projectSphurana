import { describe, expect, it } from 'vitest';
import { getServerConfig } from './server.js';

const fullEnv = {
  API_URL: 'https://api.example.com',
  APP_URL: 'https://app.example.com',
  APP_ENV: 'production',
  POSTHOG_KEY: 'phc_test',
  POSTHOG_HOST: 'https://eu.i.posthog.com',
  SENTRY_DSN: 'https://abc@sentry.io/123',
  INTERCOM_APP_ID: 'intercom_123',
};

describe('getServerConfig', () => {
  it('returns a validated config when all required vars are set', () => {
    const config = getServerConfig(fullEnv as NodeJS.ProcessEnv);
    expect(config.apiUrl).toBe('https://api.example.com');
    expect(config.appUrl).toBe('https://app.example.com');
    expect(config.posthogKey).toBe('phc_test');
    expect(config.posthogHost).toBe('https://eu.i.posthog.com');
    expect(config.sentryDsn).toBe('https://abc@sentry.io/123');
    expect(config.intercomAppId).toBe('intercom_123');
  });

  it('coerces missing optional/nullable vars to null/undefined', () => {
    const config = getServerConfig({
      ...fullEnv,
      SENTRY_DSN: '',
      INTERCOM_APP_ID: undefined,
    } as NodeJS.ProcessEnv);
    expect(config.sentryDsn).toBeNull();
    expect(config.intercomAppId).toBeNull();
    expect(config.googleMapsApiKey).toBeUndefined();
  });

  it('throws if API_URL is missing', () => {
    const { API_URL: _omit, ...env } = fullEnv;
    void _omit;
    expect(() => getServerConfig(env as NodeJS.ProcessEnv)).toThrowError(
      /apiUrl/i
    );
  });

  it('throws if POSTHOG_KEY is missing', () => {
    const { POSTHOG_KEY: _omit, ...env } = fullEnv;
    void _omit;
    expect(() => getServerConfig(env as NodeJS.ProcessEnv)).toThrowError(
      /posthogKey/i
    );
  });

  it('throws if POSTHOG_HOST is missing', () => {
    const { POSTHOG_HOST: _omit, ...env } = fullEnv;
    void _omit;
    expect(() => getServerConfig(env as NodeJS.ProcessEnv)).toThrowError(
      /posthogHost/i
    );
  });

  it('throws if APP_URL is missing', () => {
    const { APP_URL: _omit, ...env } = fullEnv;
    void _omit;
    expect(() => getServerConfig(env as NodeJS.ProcessEnv)).toThrowError(
      /appUrl/i
    );
  });

  it('throws on malformed APP_URL', () => {
    expect(() =>
      getServerConfig({ ...fullEnv, APP_URL: 'not-a-url' } as NodeJS.ProcessEnv)
    ).toThrowError(/appUrl/i);
  });

  it('treats empty string env vars as unset for required fields', () => {
    expect(() =>
      getServerConfig({ ...fullEnv, API_URL: '' } as NodeJS.ProcessEnv)
    ).toThrowError(/apiUrl/i);
  });

  it('parses CDN_ENABLED as a boolean', () => {
    const enabled = getServerConfig({
      ...fullEnv,
      CDN_ENABLED: 'true',
    } as NodeJS.ProcessEnv);
    expect(enabled.cdnEnabled).toBe(true);

    const disabled = getServerConfig({
      ...fullEnv,
      CDN_ENABLED: 'false',
    } as NodeJS.ProcessEnv);
    expect(disabled.cdnEnabled).toBe(false);
  });
});
