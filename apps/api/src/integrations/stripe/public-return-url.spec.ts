/**
 * Regression for API-6T: "You cannot redirect to localhost in a livemode
 * request." — 42 production events on `POST /integrations/stripe/account-link`,
 * tagged `browser: Android WebView`, still firing after the client-side origin
 * fix (#666) because native bundles bake their origin at build time.
 */
import { publicReturnUrl } from './public-return-url.js';

const ORIGIN = 'https://app.borradh.test';

jest.mock('../../common/oauth/index.js', () => ({
  webOrigin: () => ORIGIN,
}));

describe('publicReturnUrl', () => {
  // The origins a Capacitor WebView actually reports. `https://localhost` is
  // Android — which is what the production event was sent from, and the only
  // one of these that can reach the sanitiser through the account-link route:
  // the contract's `externalRedirectUrl` 400s a non-http(s) scheme first. The
  // capacitor/ionic cases are defence in depth for any caller not behind it.
  it.each([
    'capacitor://localhost',
    'ionic://localhost',
    'https://localhost',
    'http://localhost',
    'http://127.0.0.1:5173',
  ])('rebases the unreachable origin %s', (origin) => {
    const rebased = publicReturnUrl(
      `${origin}/settings/payments?stripe=return`
    );

    expect(rebased).toBe(`${ORIGIN}/settings/payments?stripe=return`);
  });

  it('keeps the path, query and hash the client chose', () => {
    expect(
      publicReturnUrl('capacitor://localhost/a/b?stripe=refresh&x=1#frag')
    ).toBe(`${ORIGIN}/a/b?stripe=refresh&x=1#frag`);
  });

  it('passes one of OUR origins through untouched', () => {
    // Must NOT pin every environment to production: a preview and a dev/staging
    // origin are legitimate and have to survive.
    const preview =
      'https://borradh-app-git-feat-x-borradh-technologies.vercel.app/s?stripe=return';
    const devStaging = 'https://app.pavit.borradh-dev.com/settings/payments';

    expect(publicReturnUrl(preview)).toBe(preview);
    expect(publicReturnUrl(devStaging)).toBe(devStaging);
    expect(publicReturnUrl('https://app.borradh.io/settings')).toBe(
      'https://app.borradh.io/settings'
    );
    expect(publicReturnUrl(`${ORIGIN}/settings?stripe=return`)).toBe(
      `${ORIGIN}/settings?stripe=return`
    );
  });

  /**
   * The reason this is an allow-list and not just a loopback repair.
   * `externalRedirectUrl` accepts ANY https URL, so an attacker-supplied origin
   * passes contract validation — and Stripe would then walk the user there at
   * the end of Connect onboarding. The origin is replaced; the path the caller
   * chose is kept, which is harmless once it lands on our own app.
   */
  it.each([
    'https://evil.com/whatever?stripe=return',
    'https://app.borradh.io.evil.com/settings',
    'https://borradh-app-git-x-someone-else.vercel.app/settings',
    'https://app.borradh-dev.com.evil.co/settings',
  ])('rebases the untrusted origin %s onto ours', (hostile) => {
    const rebased = publicReturnUrl(hostile);

    expect(new URL(rebased).origin).toBe(ORIGIN);
    expect(rebased.startsWith(ORIGIN)).toBe(true);
  });

  /**
   * This is a sanitiser, not a validator. `payments-infra.int-spec.ts` asserts
   * that a malformed or absent URL is a 400 — so repairing one here would
   * convert a rejected request into an accepted one, and an absent one used to
   * throw a TypeError out of the controller as a 500.
   */
  it.each([
    ['not-a-url', 'not-a-url'],
    ['/settings/payments?stripe=return', '/settings/payments?stripe=return'],
    ['', ''],
    [undefined as unknown as string, undefined as unknown as string],
  ])('passes %p through untouched for validation to reject', (input, want) => {
    expect(publicReturnUrl(input)).toBe(want);
  });
});
