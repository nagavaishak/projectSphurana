import { afterEach, describe, expect, it } from '@borradh-workspace/testing';

import {
  PREVIEW_TOKEN_TTL_SECONDS,
  mintPreviewToken,
  verifyPreviewToken,
} from './preview-token.js';

const SECRET = 'a'.repeat(48);
const ORIGINAL = process.env.BETTER_AUTH_SECRET;

afterEach(() => {
  process.env.BETTER_AUTH_SECRET = ORIGINAL;
});

const withSecret = (secret: string | undefined) => {
  if (secret === undefined) {
    process.env = { ...process.env, BETTER_AUTH_SECRET: undefined } as never;
    process.env.BETTER_AUTH_SECRET = '';
  } else {
    process.env.BETTER_AUTH_SECRET = secret;
  }
};

describe('preview tokens', () => {
  it('round-trips for the microsite it was minted for', () => {
    withSecret(SECRET);
    const token = mintPreviewToken('ms_1');
    expect(token).not.toBeNull();
    expect(verifyPreviewToken('ms_1', token)).toBe(true);
  });

  it('REFUSES a token minted for a different microsite', () => {
    // The whole point of binding to the id: otherwise a tenant's own preview
    // token reads every other tenant's unpublished draft.
    withSecret(SECRET);
    const token = mintPreviewToken('ms_1');
    expect(verifyPreviewToken('ms_2', token)).toBe(false);
  });

  it('refuses an expired token', () => {
    withSecret(SECRET);
    const mintedAt = 1_000_000;
    const token = mintPreviewToken('ms_1', mintedAt);
    const afterExpiry = mintedAt + PREVIEW_TOKEN_TTL_SECONDS + 1;
    expect(verifyPreviewToken('ms_1', token, afterExpiry)).toBe(false);
    expect(verifyPreviewToken('ms_1', token, afterExpiry - 2)).toBe(true);
  });

  it('refuses a token whose expiry was edited to extend it', () => {
    // The exp is in the signed payload, so moving it invalidates the signature.
    withSecret(SECRET);
    const token = mintPreviewToken('ms_1', 1_000_000) as string;
    const sig = token.slice(token.indexOf('.') + 1);
    const forged = `${1_000_000 + 99_999}.${sig}`;
    expect(verifyPreviewToken('ms_1', forged, 1_000_100)).toBe(false);
  });

  it('refuses garbage, empty and malformed tokens', () => {
    withSecret(SECRET);
    for (const bad of ['', 'nope', '.', '123.', 'abc.def', '999999999999.x']) {
      expect(verifyPreviewToken('ms_1', bad)).toBe(false);
    }
    expect(verifyPreviewToken('ms_1', undefined)).toBe(false);
    expect(verifyPreviewToken('ms_1', null)).toBe(false);
  });

  it('FAILS CLOSED when no adequate secret is configured', () => {
    // Minting must return null rather than something guessable, and verifying
    // must refuse rather than accept — a weak secret is not a reason to serve
    // every tenant's draft.
    withSecret('too-short');
    expect(mintPreviewToken('ms_1')).toBeNull();
    expect(verifyPreviewToken('ms_1', '9999999999.whatever')).toBe(false);
  });

  it('does not accept a token signed under a different secret', () => {
    withSecret(SECRET);
    const token = mintPreviewToken('ms_1');
    withSecret('b'.repeat(48));
    expect(verifyPreviewToken('ms_1', token)).toBe(false);
  });
});
