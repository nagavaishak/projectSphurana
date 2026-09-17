import { describe, expect, it, vi } from 'vitest';

import { parseResponse, setResponseParseConfig } from './parse.js';

/**
 * Empty-body normalization. Nest returns a 200 with an EMPTY BODY for a handler
 * that resolves `null` (e.g. `GET /onboarding/session`, a non-creating peek),
 * and ky's `.json()` turns an empty body into `''`, not `null`. Consumers write
 * `session ?? fallback` / `session?.status`, so a `''` leaks through as a
 * present-but-empty object: the onboarding deck read `''.currentSlide` as
 * `undefined` and dropped every brand-new user past Claire's intro slide.
 */
describe('parseResponse — empty body', () => {
  it('normalizes an empty-string body to null (no schema)', () => {
    expect(
      parseResponse('onboarding/session', '' as unknown as null)
    ).toBeNull();
  });

  it('normalizes an empty-string body to null before schema validation', () => {
    const schema = {
      safeParse: vi.fn((data: unknown) => ({
        success: true as const,
        data: data as null,
      })),
    };

    expect(
      parseResponse('onboarding/session', '' as unknown as null, schema)
    ).toBeNull();
    expect(schema.safeParse).toHaveBeenCalledWith(null);
  });

  it('leaves real payloads untouched', () => {
    const body = { status: 'active', currentSlide: 'intro' };
    expect(parseResponse('onboarding/session', body)).toBe(body);
    expect(parseResponse('leads', [])).toEqual([]);
    expect(parseResponse('billing/credits', 0)).toBe(0);
  });
});

describe('parseResponse — schema modes', () => {
  it('report mode passes the raw data through and reports the mismatch', () => {
    const onParseError = vi.fn();
    setResponseParseConfig({ isStrict: () => false, onParseError });

    const body = { id: 1 };
    const schema = {
      safeParse: () => ({ success: false as const, error: 'boom' }),
    };

    expect(parseResponse('leads/1', body, schema)).toBe(body);
    expect(onParseError).toHaveBeenCalledWith({
      endpoint: 'leads/1',
      error: 'boom',
    });

    setResponseParseConfig({});
  });
});
