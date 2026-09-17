import { describe, expect, it } from 'vitest';
import { runtimeConfigSchema } from './schema.js';

const baseInput = {
  apiUrl: 'https://api.example.com',
  appUrl: 'https://app.example.com',
  posthogKey: 'phc_test',
  posthogHost: 'https://eu.i.posthog.com',
};

describe('runtimeConfigSchema', () => {
  it('parses a minimal valid input', () => {
    const result = runtimeConfigSchema.parse(baseInput);
    expect(result.apiUrl).toBe(baseInput.apiUrl);
    expect(result.appEnv).toBe('production');
    expect(result.cdnEnabled).toBe(false);
    expect(result.sentryDsn).toBeNull();
  });

  it('rejects an invalid apiUrl (not absolute, not /)', () => {
    expect(() =>
      runtimeConfigSchema.parse({ ...baseInput, apiUrl: 'localhost:3000' })
    ).toThrowError(/apiUrl/);
  });

  it('accepts a same-origin relative apiUrl like /nest', () => {
    const result = runtimeConfigSchema.parse({ ...baseInput, apiUrl: '/nest' });
    expect(result.apiUrl).toBe('/nest');
  });

  it('rejects a protocol-relative apiUrl like //evil.com/api', () => {
    expect(() =>
      runtimeConfigSchema.parse({ ...baseInput, apiUrl: '//evil.com/api' })
    ).toThrowError(/apiUrl/);
  });

  it('rejects a javascript: apiUrl', () => {
    expect(() =>
      runtimeConfigSchema.parse({ ...baseInput, apiUrl: 'javascript:alert(1)' })
    ).toThrowError(/apiUrl/);
  });

  it('rejects a missing posthogKey', () => {
    const { posthogKey: _omit, ...rest } = baseInput;
    void _omit;
    expect(() => runtimeConfigSchema.parse(rest)).toThrowError(/posthogKey/);
  });

  it('rejects a non-URL posthogHost', () => {
    expect(() =>
      runtimeConfigSchema.parse({ ...baseInput, posthogHost: 'not-a-url' })
    ).toThrowError(/posthogHost/);
  });

  it('rejects an unknown appEnv value', () => {
    expect(() =>
      runtimeConfigSchema.parse({ ...baseInput, appEnv: 'qa' })
    ).toThrowError(/appEnv/);
  });

  it('coerces empty-string optional fields to undefined/null', () => {
    const result = runtimeConfigSchema.parse({
      ...baseInput,
      intercomAppId: '',
      googleMapsApiKey: '',
    });
    expect(result.intercomAppId).toBeNull();
    expect(result.googleMapsApiKey).toBeUndefined();
  });

  it('parses CDN_ENABLED string "true" / "false" to boolean', () => {
    expect(
      runtimeConfigSchema.parse({ ...baseInput, cdnEnabled: 'true' }).cdnEnabled
    ).toBe(true);
    expect(
      runtimeConfigSchema.parse({ ...baseInput, cdnEnabled: 'false' })
        .cdnEnabled
    ).toBe(false);
  });
});
