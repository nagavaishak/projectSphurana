import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import {
  OAUTH_STATE_MAX_AGE_MS,
  safeReturnTo,
  signOAuthState,
  verifyOAuthState,
} from './oauth-state.js';

const SECRET = 'a'.repeat(48);

describe('oauth-state', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = SECRET;
  });

  it('round-trips a signed state', () => {
    const state = signOAuthState({
      organizationId: 'org_1',
      userId: 'user_1',
      provider: 'stripe',
      returnTo: '/onboarding',
    });
    expect(state).toBeTruthy();

    const payload = verifyOAuthState(state as string, 'stripe');
    expect(payload?.organizationId).toBe('org_1');
    expect(payload?.userId).toBe('user_1');
    expect(payload?.returnTo).toBe('/onboarding');
  });

  /**
   * THE VULNERABILITY THIS FILE EXISTS FOR.
   *
   * Exactly the pre-fix format: base64 JSON, no signature. Every callback used
   * to accept this and act on whatever organizationId it named.
   */
  it('rejects the unsigned base64 JSON state the callbacks used to trust', () => {
    const forged = Buffer.from(
      JSON.stringify({
        organizationId: 'victim_org',
        userId: 'victim_user',
        provider: 'stripe',
        timestamp: Date.now(),
      })
    ).toString('base64');

    expect(verifyOAuthState(forged, 'stripe')).toBeNull();
  });

  it('rejects a state whose payload was edited after signing', () => {
    const signed = signOAuthState({
      organizationId: 'attacker_org',
      userId: 'attacker',
      provider: 'stripe',
    }) as string;

    const [, sig] = signed.split('.');
    const tampered = `${Buffer.from(
      JSON.stringify({
        organizationId: 'victim_org',
        userId: 'attacker',
        provider: 'stripe',
        timestamp: Date.now(),
      })
    ).toString('base64url')}.${sig}`;

    expect(verifyOAuthState(tampered, 'stripe')).toBeNull();
  });

  it('rejects a state signed with a different secret', () => {
    const signed = signOAuthState({
      organizationId: 'org_1',
      provider: 'stripe',
    }) as string;
    process.env.BETTER_AUTH_SECRET = 'b'.repeat(48);
    expect(verifyOAuthState(signed, 'stripe')).toBeNull();
  });

  /**
   * Without this, a caller who may legitimately start a Gmail connect could
   * drive the Stripe callback with the same blob.
   */
  it('rejects a state minted for a different provider', () => {
    const signed = signOAuthState({
      organizationId: 'org_1',
      provider: 'gmail',
    }) as string;
    expect(verifyOAuthState(signed, 'stripe')).toBeNull();
    expect(verifyOAuthState(signed, 'gmail')).not.toBeNull();
  });

  it('rejects an expired state', () => {
    const signed = signOAuthState({
      organizationId: 'org_1',
      provider: 'stripe',
      timestamp: Date.now() - OAUTH_STATE_MAX_AGE_MS - 1000,
    }) as string;
    expect(verifyOAuthState(signed, 'stripe')).toBeNull();
  });

  it('rejects a state stamped in the future beyond clock-skew allowance', () => {
    const signed = signOAuthState({
      organizationId: 'org_1',
      provider: 'stripe',
      timestamp: Date.now() + 10 * 60 * 1000,
    }) as string;
    expect(verifyOAuthState(signed, 'stripe')).toBeNull();
  });

  it.each(['', 'garbage', 'no-dot-here', '.', 'a.b'])(
    'rejects malformed state %p',
    (bad) => {
      expect(verifyOAuthState(bad, 'stripe')).toBeNull();
    }
  );

  it('refuses to mint or verify without an adequate secret', () => {
    const signed = signOAuthState({
      organizationId: 'org_1',
      provider: 'stripe',
    }) as string;
    process.env.BETTER_AUTH_SECRET = 'too-short';
    expect(
      signOAuthState({ organizationId: 'org_1', provider: 'stripe' })
    ).toBeNull();
    expect(verifyOAuthState(signed, 'stripe')).toBeNull();
  });

  describe('safeReturnTo', () => {
    it.each([
      ['/dashboard/x', '/dashboard/x'],
      ['/onboarding', '/onboarding'],
      [undefined, '/dashboard/integrations'],
      ['//evil.com', '/dashboard/integrations'],
      ['https://evil.com', '/dashboard/integrations'],
      ['javascript://evil', '/dashboard/integrations'],
      ['dashboard/x', '/dashboard/integrations'],
    ])('maps %p to %p', (input, expected) => {
      expect(safeReturnTo(input as string | undefined)).toBe(expected);
    });
  });
});
