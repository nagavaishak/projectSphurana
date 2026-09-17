/**
 * Cases are the verbatim shapes from the Sentry sweep: the seven-fingerprint
 * Resend `@example.com` family (~2,900 events), the Stripe stub key, the
 * `provision-org` harness route, the E2E BullMQ jobs, and the missing fixture
 * asset. Each consumed first-seen Linear tickets that production faults needed.
 */
import { isTestFixtureNoise } from './is-test-fixture-noise.js';

const err = (message: string) => new Error(message);

describe('isTestFixtureNoise', () => {
  it.each([
    ['Invalid `to` field. The email address e2e.1754@example.com is invalid.'],
    ['Failed to send email: Invalid `to` field: user@example.com'],
    ['Invalid API Key provided: sk_test_****stub'],
    ['could not renew lock for job claire-classify-e2e_test_9912'],
    ['NoSuchKey: The specified key does not exist. /e2e/procedure1.mp4'],
  ])('drops harness noise: %s', (message) => {
    expect(isTestFixtureNoise({ error: err(message) })).toBe(true);
  });

  it('drops anything raised on a /testing/ harness route outside production', () => {
    // provision-org fails many ways; the ROUTE is what marks it as ours.
    expect(
      isTestFixtureNoise({
        error: err('400 - Invalid email address.'),
        transaction: 'POST /testing/provision-org',
        environment: 'preview',
      })
    ).toBe(true);
  });

  /**
   * The route rule drops on the route ALONE, whatever the message. In
   * production that would be a blanket over a whole URL prefix, so it is
   * suppressed there — the harness routes are not mounted in production today,
   * and if that ever changes the failure mode must not be a silent incident.
   */
  it('keeps a /testing/ event raised in production', () => {
    expect(
      isTestFixtureNoise({
        error: err('400 - Invalid email address.'),
        transaction: 'POST /testing/provision-org',
        environment: 'production',
      })
    ).toBe(false);
  });

  it('still drops a harness-minted MESSAGE in production, route or not', () => {
    // The harness mints these identifiers itself, so no production code path
    // can emit them and they need no environment gate.
    expect(
      isTestFixtureNoise({
        error: err(
          'could not renew lock for job claire-classify-e2e_test_9912'
        ),
        transaction: 'POST /assistant/chat',
        environment: 'production',
      })
    ).toBe(true);
  });

  /**
   * A user cannot type `sk_test_`, but a misconfiguration can put one in a
   * live secret — and then production rejects every payment with this exact
   * message. Dropping it would turn a total payments outage into silence.
   */
  it('keeps a stub Stripe key raised in production', () => {
    expect(
      isTestFixtureNoise({
        error: err('Invalid API Key provided: sk_test_****stub'),
        transaction: 'POST /integrations/stripe/account-link',
        environment: 'production',
      })
    ).toBe(false);
  });

  it('still drops a stub Stripe key outside production', () => {
    expect(
      isTestFixtureNoise({
        error: err('Invalid API Key provided: sk_test_****stub'),
        transaction: 'POST /integrations/stripe/account-link',
        environment: 'preview',
      })
    ).toBe(true);
  });

  it.each([
    ['PostgresError: duplicate key value violates unique constraint'],
    ['You cannot redirect to localhost in a livemode request.'],
    ['Too many requests. You can only make 10 requests per second.'],
    // A real recipient bounce must still be reported.
    ['Invalid `to` field. The email address real.user@gmail.com is invalid.'],
    // Mentions the fixture domain but is NOT the provider rejecting it.
    ['Organization example.com failed to sync'],
  ])('keeps a real product error: %s', (message) => {
    expect(isTestFixtureNoise({ error: err(message) })).toBe(false);
  });

  it('keeps a real error on a normal route', () => {
    expect(
      isTestFixtureNoise({
        error: err('Failed to create practitioner'),
        transaction: 'POST /practitioners',
      })
    ).toBe(false);
  });

  it('handles a non-Error thrown value without crashing beforeSend', () => {
    expect(isTestFixtureNoise({ error: 'a string' })).toBe(false);
    expect(isTestFixtureNoise({ error: undefined })).toBe(false);
  });
});
