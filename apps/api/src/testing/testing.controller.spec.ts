// Heavy transitive deps the controller doesn't actually need at test time.
// The features barrels reach ESM-only packages (`@t3-oss/env-core`) that
// swc-jest can't transform — stub them out at module-init.
jest.mock('@borradh-workspace/env/api', () => ({ apiEnv: {} }));
jest.mock('@borradh-workspace/database', () => ({}), { virtual: true });
jest.mock(
  '@borradh-workspace/features/meta-ads',
  () => ({ runHealthAlerts: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/meta-campaigns',
  () => ({
    inspectConversationIntent: jest.fn(),
    listCampaignConversationIntents: jest.fn(),
  }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/voice-cloning',
  () => ({ queueVoiceIngest: jest.fn() }),
  { virtual: true }
);

// Sibling testing.service pulls auth/server -> email -> env-core (ESM-only)
// at module init; we never call into a real service instance, so stub it.
jest.mock('./testing.service', () => ({
  TestingService: class StubTestingService {},
}));

import { PATH_METADATA } from '@nestjs/common/constants';
import { DestructiveTestingGuard, SeedTokenGuard } from './guards';
import { TestingController } from './testing.controller';

/**
 * `/testing/*` ACCESS TIERS ARE PINNED HERE.
 *
 * The two tiers used to be private methods called as the first line of every
 * handler; they are now Guards (see `guards/seed-token.guard.ts`, whose spec
 * covers the env-matrix behaviour that used to live in this file).
 *
 * What that move creates is a NEW failure mode worth a test of its own: a
 * handler can be added, or edited, with NO guard at all — and an unguarded
 * `/testing/*` route is an unauthenticated seed/exfiltration endpoint. Nothing
 * about the file's appearance would give that away.
 *
 * So this asserts the tiering as data:
 *   - every route carries exactly one of the two guards (no route is bare);
 *   - the destructive set is exactly the routes listed below.
 *
 * ADDING A ROUTE: pick the tier deliberately. Anything that MUTATES data, or
 * that returns a token / session (an exfiltration vector), is destructive and
 * belongs in the set. Read-only and simulation-only routes are safe-tier.
 */

/** Routes that must ALSO be blocked on production-mode hosts. */
const DESTRUCTIVE = [
  'cleanupContentBatch',
  'cleanupTestData',
  'createOrg',
  'createSession',
  'dbPoolHold',
  'deleteUserOrganizations',
  'forceCreateSubscription',
  'forceDeliveryFailure',
  'forceVerifyOrganization',
  'forceVerifyUser',
  'getResetPasswordToken',
  'getVerificationToken',
  'issueManageBookingLink',
  'issuePatientOtp',
  'provisionOrg',
  // Writes user/account/two_factor rows AND returns a TOTP secret in
  // plaintext — mutating and a credential vector, so both tiers apply.
  'seedPlatformAdmin',
  'seedStripeConnect',
  'seedTestData',
  'triggerMonthlyContentBatch',
];

const proto = TestingController.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

/** Every method on the controller that Nest has bound to an HTTP path. */
const routes = Object.getOwnPropertyNames(proto)
  .filter((name) => name !== 'constructor')
  .filter(
    (name) => Reflect.getMetadata(PATH_METADATA, proto[name]) !== undefined
  );

function guardsOf(name: string): unknown[] {
  return (Reflect.getMetadata('__guards__', proto[name]) ?? []) as unknown[];
}

describe('TestingController access tiers', () => {
  it('finds the routes at all (no vacuous pass)', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it('guards every route with exactly one access tier', () => {
    const bare = routes.filter(
      (name) =>
        guardsOf(name).filter(
          (g) => g === SeedTokenGuard || g === DestructiveTestingGuard
        ).length !== 1
    );
    expect(bare).toEqual([]);
  });

  it('puts exactly the mutating / token-returning routes behind the destructive tier', () => {
    const actual = routes
      .filter((name) => guardsOf(name).includes(DestructiveTestingGuard))
      .sort();
    expect(actual).toEqual([...DESTRUCTIVE].sort());
  });

  it('leaves every other route on the safe tier', () => {
    const expected = routes
      .filter((name) => !DESTRUCTIVE.includes(name))
      .sort();
    const actual = routes
      .filter((name) => guardsOf(name).includes(SeedTokenGuard))
      .sort();
    expect(actual).toEqual(expected);
  });
});
