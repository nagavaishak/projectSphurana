import {
  organization,
  subscriptions,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  type SupportedCurrency,
  getStripeService,
} from '@borradh-workspace/integrations/stripe';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  currencyForCountry,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { getOrgCountry } from '../../../shared/org-context.js';
import {
  type ResolveBillingCurrencyInput,
  resolveBillingCurrencySchema,
} from './resolve-billing-currency.schema.js';

export interface BillingCurrencyResult {
  /**
   * The currency to bill this org in: the currency their Stripe customer is
   * already locked to, else the currency derived from their location country,
   * else null when we can't determine one (so the frontend may detect one).
   */
  currency: SupportedCurrency | null;
}

/**
 * The Stripe billing currency for an org located in `country` (lowercase ISO
 * alpha-2), narrowed to a currency we actually have Stripe prices for. Only
 * EUR/USD/GBP are supported; every other market (CAD/AUD/NZD/…) bills in USD.
 * A null/unknown country yields null so callers can fall back.
 */
export const billingCurrencyForCountry = (
  country: string | null | undefined
): SupportedCurrency | null => {
  if (!country) return null;
  const code = currencyForCountry(country).code.toLowerCase();
  if (code === 'eur' || code === 'gbp') return code;
  return 'usd';
};

/**
 * Resolve the currency an organization's Stripe customer is locked to. Stripe
 * locks a customer to the currency of their first subscription/invoice, so the
 * billing UI must display that currency rather than a browser-detected one.
 */
const resolveBillingCurrencyImpl = async (
  db: DbConnection,
  input: ResolveBillingCurrencyInput
): Promise<Result<BillingCurrencyResult>> => {
  const parsed = resolveBillingCurrencySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const org = await withOrgScope(
    (tx) =>
      tx.query.organization.findFirst({
        where: and(
          eq(organization.id, organizationId),
          notDeleted(organization)
        ),
      }),
    { db }
  );

  const subscription = await withOrgScope(
    (tx) =>
      tx.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, organizationId),
      }),
    { db }
  );

  const customerId =
    org?.stripeCustomerId ?? subscription?.stripeCustomerId ?? undefined;

  // If a Stripe customer is already locked to a currency (set on their first
  // subscription/invoice), that currency is authoritative - Stripe forbids
  // mixing currencies on one customer.
  if (customerId) {
    const locked = await getStripeService().getCustomerCurrency(customerId);
    if (locked) {
      return ok({ currency: locked });
    }
  }

  // No locked currency yet (note: orgs get a pre-created Stripe customer at
  // signup, so `customerId` is usually set but unlocked). Derive the currency
  // from the org's location country - an IE clinic bills in EUR, a GB one in
  // GBP - rather than letting the frontend sniff the browser locale, which
  // shows GBP for an Irish org on an en-GB device. When we don't know the
  // country, return null so the frontend can still detect one.
  const country = await getOrgCountry(db, organizationId);
  return ok({ currency: billingCurrencyForCountry(country) });
};

export const resolveBillingCurrency = (
  db: DbConnection,
  input: ResolveBillingCurrencyInput
) =>
  trackedResult(
    'billing.resolveBillingCurrency',
    () => resolveBillingCurrencyImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ResolveBillingCurrencyResult = Awaited<
  ReturnType<typeof resolveBillingCurrency>
>;
