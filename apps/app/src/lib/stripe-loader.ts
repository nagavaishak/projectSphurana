import { loadConnectAndInitialize } from '@stripe/connect-js';
import { type Stripe, loadStripe } from '@stripe/stripe-js';
import { logError } from './log-error';

/**
 * Stripe.js loaders reject/throw when the loader script can't be fetched or the
 * key is malformed. The frontend attaches these to `<Elements>` / a `useState`
 * initializer with no `.catch`, so a rejection surfaces as an UNHANDLED promise
 * rejection. PostHog's exception autocapture lives in a lazily-loaded extension
 * script and can miss unhandled rejections (Sentry installs global handlers
 * synchronously and still catches them). Routing the failure through the
 * explicit `logError` path guarantees it lands in BOTH tools reliably.
 *
 * Each wrapper re-throws after capturing, so the existing UI / error-boundary
 * behavior is unchanged.
 */

/** `loadStripe` with the rejection captured via `logError` and re-thrown. */
export function loadStripeWithCapture(
  ...args: Parameters<typeof loadStripe>
): Promise<Stripe | null> {
  return loadStripe(...args).catch((error: unknown) => {
    logError('sales.loadStripe', error);
    throw error;
  });
}

/**
 * `loadConnectAndInitialize` with a synchronous throw captured via `logError`
 * and re-thrown. This loader returns its instance synchronously (it throws for
 * a malformed publishable key), so a try/catch — not a `.catch` — is the
 * correct shape here.
 */
export function loadConnectWithCapture(
  ...args: Parameters<typeof loadConnectAndInitialize>
): ReturnType<typeof loadConnectAndInitialize> {
  try {
    return loadConnectAndInitialize(...args);
  } catch (error) {
    logError('stripeConnect.loadConnect', error);
    throw error;
  }
}
