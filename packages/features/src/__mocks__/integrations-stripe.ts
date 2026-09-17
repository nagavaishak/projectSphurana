/**
 * Canonical mock for `@borradh-workspace/integrations/stripe`.
 *
 * Aliased in vite.config.ts so the real Stripe SDK is never loaded in tests,
 * and so every test file sees the *same* mock — a prerequisite for
 * `isolate: false`. See docs/plans/features-test-isolation-windows.md.
 *
 * `StripeService` / `StripeConnectService` are `vi.fn()` constructors that
 * always return the SAME stable instance object (see `_integration-service-mock`).
 * `getStripeService` / `getStripeConnectService` return those same instances.
 *
 * `DEFAULT_CREDIT_RATES` / `DEFAULT_PLAN` / `DEFAULT_CREDIT_PACKAGES` are config
 * data, not behaviour — exported as static literals matching the real values.
 *
 * Test files should NOT `vi.mock('@borradh-workspace/integrations/stripe')` —
 * import the symbol and drive it with `vi.mocked()`.
 * `beforeEach(vi.clearAllMocks())` resets call history between tests.
 */
import { vi } from 'vitest';
import { createServiceMock } from './_integration-service-mock.js';

const stripeService = createServiceMock();
const stripeConnectService = createServiceMock();

/** Stable shared instance returned by every `new StripeService(...)`. */
export const mockStripeService = stripeService.instance;
/** Stable shared instance returned by every `new StripeConnectService(...)`. */
export const mockStripeConnectService = stripeConnectService.instance;

export const StripeService = stripeService.ctor;
export const StripeConnectService = stripeConnectService.ctor;

export const getStripeService = vi.fn(() => mockStripeService);
export const getStripeConnectService = vi.fn(() => mockStripeConnectService);

// --- Error classifiers ----------------------------------------------------
// The real implementations narrow with `instanceof Stripe.errors.StripeError`,
// which is unavailable here (the SDK is never loaded in tests). These are
// duck-typed stand-ins keyed on the same fields, so a test can drive either
// branch by constructing an error with (or without) a 4xx `statusCode`. The
// real logic is covered directly in
// packages/integrations/src/stripe/stripe-connect.errors.test.ts.
const asStripeError = (error: unknown) =>
  error instanceof Error && 'raw' in error && 'statusCode' in error
    ? (error as Error & Record<string, unknown>)
    : null;

export const isTerminalDeauthorizeRefusal = (error: unknown): boolean => {
  const stripeError = asStripeError(error);
  const status = stripeError?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
};

export const isUnknownAccountError = (error: unknown): boolean => {
  const stripeError = asStripeError(error);
  if (!stripeError) return false;
  if (
    stripeError.code === 'resource_missing' ||
    stripeError.code === 'account_invalid'
  ) {
    return true;
  }
  const status = stripeError.statusCode;
  return status === 403 || status === 404;
};

export const BORRADH_ORG_METADATA_KEY = 'borradh_organization_id';

export const describeStripeError = (
  error: unknown
): Record<string, unknown> | undefined => {
  const stripeError = asStripeError(error);
  if (!stripeError) return undefined;
  return {
    stripeErrorType: stripeError.type,
    stripeRawType: stripeError.rawType,
    stripeErrorCode: stripeError.code,
    stripeStatusCode: stripeError.statusCode,
    stripeRequestId: stripeError.requestId,
  };
};

// --- Config data (static literals matching the real package) --------------
export const DEFAULT_CREDIT_RATES = {
  sms: 100,
  email: 10,
  voicePerMinute: 500,
  whatsapp: 100,
};

export const DEFAULT_PLAN = {
  id: 'pro',
  name: 'Pro Plan',
  description: 'Full access to all features with monthly credits',
  priceInCents: 40000,
  interval: 'month' as const,
  stripePriceId: '',
  includedCredits: 100000,
  features: [] as string[],
};

export const DEFAULT_CREDIT_PACKAGES = [
  {
    id: 'credits-500',
    name: '500 Credits',
    credits: 50000,
    priceInCents: 5000,
    stripePriceId: '',
  },
];
