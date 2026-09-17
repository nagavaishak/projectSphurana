/**
 * The CSP is part of this feature, not a deploy detail.
 *
 * A missing origin here is silent: the browser blocks the request, the pixel
 * never fires, and nothing in the app logs an error. That exact omission broke
 * booking on www once already, which is why it gets an assertion rather than a
 * code review.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PIXEL_SCRIPT_SRC } from './pixel-runtime';

const vercelJson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../vercel.json', import.meta.url)),
    'utf8'
  )
) as {
  headers: Array<{ headers: Array<{ key: string; value: string }> }>;
};

const csp =
  vercelJson.headers
    .flatMap((entry) => entry.headers)
    .find((header) => header.key === 'Content-Security-Policy')?.value ?? '';

const directive = (name: string): string[] => {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return found ? found.split(/\s+/).slice(1) : [];
};

describe('the microsite CSP allows exactly what the pixel needs', () => {
  it('found a CSP to test — otherwise everything below is vacuous', () => {
    expect(csp).toContain("default-src 'self'");
  });

  it('allows the origin the runtime actually loads the script from', () => {
    const origin = new URL(PIXEL_SCRIPT_SRC).origin;
    expect(origin).toBe('https://connect.facebook.net');
    expect(directive('script-src')).toContain(origin);
  });

  it('allows the origins the pixel beacons to', () => {
    // fbevents.js posts events to www.facebook.com/tr and pulls its per-pixel
    // config from connect.facebook.net.
    expect(directive('connect-src')).toContain('https://www.facebook.com');
    expect(directive('connect-src')).toContain('https://connect.facebook.net');
  });

  it('adds no Meta origin beyond those', () => {
    const metaOrigins = csp
      .split(/[\s;]+/)
      .filter((token) => /facebook|fbcdn|instagram/i.test(token));
    expect(new Set(metaOrigins)).toEqual(
      new Set(['https://connect.facebook.net', 'https://www.facebook.com'])
    );
  });

  it('still frames nothing and still defaults to self', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(directive('default-src')).toEqual(["'self'"]);
  });
});
