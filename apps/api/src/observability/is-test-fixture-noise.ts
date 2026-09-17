/**
 * Errors produced BY the test harness rather than by the product.
 *
 * Preview carries roughly 60x production's error volume because every PR
 * preview runs the full E2E suite against a real API. That noise is not
 * harmless: Sentry's Linear rule fires on FIRST-SEEN with no threshold, so a
 * fingerprint that debuts in preview consumes its ticket there and never files
 * one when the same fault later appears in production.
 *
 * Most MESSAGE markers below are inherently a fixture artifact — a reserved
 * example domain, an `e2e_test_` job name, an `/e2e/` media path. Those are
 * identifiers the harness itself mints, so no production code path can emit
 * them and they are dropped in all environments rather than gated on one.
 *
 * `sk_test_` is the exception. A real USER cannot produce it, but a
 * MISCONFIGURATION can: a Stripe test key wired into a live secret makes
 * production reject every payment with `Invalid API Key provided: sk_test_…`.
 * That is a total payments outage wearing a fixture's clothing, so the marker
 * is gated on the environment like the route rule below.
 *
 * The `/testing/` ROUTE rule is different and is gated on the environment. It
 * drops an event on the strength of the route alone, whatever the message, so
 * in production it would be a blanket over a whole URL prefix. Those routes are
 * mounted only outside production today — but "today" is exactly the assumption
 * that goes stale silently, and the failure mode is a real incident that never
 * files a ticket. Outside production the same rule costs nothing.
 */

/** Reserved by RFC 2606 for documentation/tests; never a deliverable address. */
const FIXTURE_EMAIL_DOMAIN = '@example.com';

const FIXTURE_MARKERS = [
  // BullMQ jobs the E2E suite enqueues, e.g. `claire-classify-e2e_test_…`.
  'e2e_test_',
  // Fixture media the suite uploads/reads, e.g. S3 404 on `/e2e/procedure1.mp4`.
  '/e2e/',
];

/**
 * Seeded Stripe stub key used by the preview/E2E payments fixtures. Dropped
 * outside production only — in production this string means a test key reached
 * a live secret, which is an incident, not noise.
 */
const STUB_STRIPE_KEY_MARKER = 'sk_test_';

/** Routes that exist only to let the harness bypass flows; off in production. */
const HARNESS_ROUTE = '/testing/';

/**
 * True when the event is harness noise and should not reach Sentry.
 *
 * `transaction` is checked as well as the message because the harness routes
 * fail in many different ways (validation, provisioning races) and it is the
 * ROUTE, not the message, that marks them as ours.
 */
export function isTestFixtureNoise(input: {
  error: unknown;
  transaction?: string;
  /**
   * The DEPLOY environment the event was raised in. The route-based rule is
   * suppressed when this is 'production' so a `/testing/` prefix can never
   * blanket a genuine production incident, should those routes ever be mounted
   * there. Message-based rules are unaffected.
   */
  environment?: string;
}): boolean {
  const { error, transaction, environment } = input;

  if (environment !== 'production' && transaction?.includes(HARNESS_ROUTE)) {
    return true;
  }

  const message = error instanceof Error ? error.message : '';
  if (!message) return false;

  if (FIXTURE_MARKERS.some((marker) => message.includes(marker))) return true;

  if (
    environment !== 'production' &&
    message.includes(STUB_STRIPE_KEY_MARKER)
  ) {
    return true;
  }

  // Narrow on purpose: only the provider's rejection of a fixture recipient,
  // not every mention of the domain. A real user CAN type an @example.com
  // address — that send still fails and is still recorded as failed on the
  // recipient row, which is the surface that actually reports it. Dropping the
  // Sentry event loses nothing actionable.
  if (
    message.includes(FIXTURE_EMAIL_DOMAIN) &&
    /invalid .?to.? field/i.test(message)
  ) {
    return true;
  }

  return false;
}
