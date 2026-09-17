import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type StripeConnectService,
  getStripeConnectService,
} from './stripe-connect.service.js';

/**
 * `StripeConnectStubService` EXTENDS the real service, so any method it does
 * not override runs the real implementation against the dummy key
 * `sk_test_e2e_stub`. That is how ~1200 Sentry events accumulated between
 * 2026-07-11 and 2026-08-19: `createAccountSession` and
 * `cancelConnectedSubscription` had no override, so every preview E2E run hit
 * real Stripe, failed on auth, and left those paths untested while the error
 * read like a live test key in a production secret.
 *
 * This test enumerates the base class from source and fails when an outbound
 * method gains no override, so the gap cannot reopen silently.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL('./stripe-connect.service.ts', import.meta.url)),
  'utf8'
);

const STUB_MARKER = 'class StripeConnectStubService';
const baseSource = SOURCE.slice(0, SOURCE.indexOf(STUB_MARKER));
const stubSource = SOURCE.slice(SOURCE.indexOf(STUB_MARKER));

/** Control-flow keywords also sit at two-space indent in module-level functions. */
const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'throw',
]);

const methodNames = (source: string, prefix: string): string[] => {
  const pattern = new RegExp(
    `^  ${prefix}(?:async )?([a-zA-Z_]\\w*)\\s*\\(`,
    'gm'
  );
  return [...source.matchAll(pattern)]
    .map((match) => match[1] as string)
    .filter((name) => !KEYWORDS.has(name));
};

/**
 * Methods that legitimately need no override because they never reach the
 * network. Deliberately explicit: adding a name here is a claim that the method
 * makes no Stripe call, and should be made consciously.
 */
const NO_NETWORK = new Set([
  // Pure string building — assembles an OAuth URL from config.
  'generateOAuthLink',
  // Local HMAC signature verification against the webhook secret.
  'constructConnectWebhookEvent',
  // Returns the client itself; callers that use it are covered by the throwing
  // proxy the stub installs over `this.stripe`.
  'getClient',
  // Delegates to getAccountInfo, which IS overridden.
  'refreshAccountStatus',
]);

describe('StripeConnectStubService coverage', () => {
  it('overrides every outbound method on the base service', () => {
    const publicBaseMethods = methodNames(baseSource, '(?:public )?').filter(
      (name) =>
        name !== 'constructor' &&
        !methodNames(baseSource, 'private ').includes(name)
    );
    const overridden = new Set(methodNames(stubSource, 'override '));

    const unstubbed = publicBaseMethods.filter(
      (name) => !overridden.has(name) && !NO_NETWORK.has(name)
    );

    expect(unstubbed).toEqual([]);
  });

  it('enumerated a plausible number of base methods', () => {
    // Guards the regex itself: if it silently stopped matching, the test above
    // would pass vacuously with an empty list.
    const publicBaseMethods = methodNames(baseSource, '(?:public )?').filter(
      (name) =>
        name !== 'constructor' &&
        !methodNames(baseSource, 'private ').includes(name)
    );
    expect(publicBaseMethods.length).toBeGreaterThan(20);
    expect(publicBaseMethods).toContain('createAccountSession');
    expect(publicBaseMethods).toContain('cancelConnectedSubscription');
  });
});

describe('StripeConnectStubService behaviour', () => {
  /**
   * `getStripeConnectService` memoises, so whichever env won the FIRST call in
   * this process decides the instance for every later one. Assert we actually
   * hold a stub rather than trusting the env var — otherwise a test-order
   * change would silently hand back the real service and these tests would
   * either pass vacuously or fail somewhere confusing.
   */
  const stub = (): StripeConnectService => {
    vi.stubEnv('STRIPE_E2E_STUB', 'true');
    const service = getStripeConnectService();
    expect(service.constructor.name).toBe('StripeConnectStubService');
    return service;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves the two calls that were reaching real Stripe', async () => {
    const service = stub();

    const session = await service.createAccountSession({
      connectedAccountId: 'acct_e2e',
    });
    expect(session.clientSecret).toContain('_secret_e2e');

    const cancelled = await service.cancelConnectedSubscription(
      'acct_e2e',
      'sub_e2e'
    );
    expect(cancelled.status).toBe('canceled');
  });

  it('throws by name rather than calling Stripe if a gap remains', () => {
    const service = stub();
    // getClient is the deliberate escape hatch; reaching through it must hit
    // the proxy rather than issue a request with the dummy key.
    expect(() => service.getClient().accounts).toThrow(
      /made a real Stripe call \(stripe\.accounts\)/
    );
  });
});
