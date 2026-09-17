import type {
  organization,
  organizationService,
} from '@borradh-workspace/database';
import type {
  BookingPaymentDefaults,
  BookingPaymentService,
} from './resolve-booking-payment.js';

/**
 * Maps the stored organization / service rows onto the resolver's input shape.
 *
 * These used to also infer a policy from the pre-policy fields
 * (`organization_service.requires_deposit`, `organization.deposit_enabled`), so
 * that clinics which had never opened the new settings kept collecting
 * deposits. `scripts/backfill-payment-policy.ts` has since written the real
 * values in production (160 services, 7 organizations) and both write paths —
 * the org Bookings tab and the service form — now send an explicit policy, so
 * the inference is gone and `payment_policy` is the sole authority on whether
 * money is due online.
 */

type ServiceRow = typeof organizationService.$inferSelect;
type OrganizationRow = typeof organization.$inferSelect;

export const toBookingPaymentService = (
  service: Pick<
    ServiceRow,
    | 'priceType'
    | 'priceCents'
    | 'paymentPolicy'
    | 'depositBasis'
    | 'depositAmountCents'
    | 'depositPercent'
  >
): BookingPaymentService => ({
  priceType: service.priceType,
  priceCents: service.priceCents,
  // null = inherit the org default, NOT "pay in clinic" — an org-wide deposit
  // must still reach a service that has never set a policy of its own.
  paymentPolicy: service.paymentPolicy,
  depositBasis: service.depositBasis,
  depositAmountCents: service.depositAmountCents,
  depositPercent: service.depositPercent,
});

export const toBookingPaymentDefaults = (
  org: Pick<
    OrganizationRow,
    | 'defaultPaymentPolicy'
    | 'defaultDepositBasis'
    | 'defaultDepositPercent'
    | 'depositAggregation'
    | 'depositEnabled'
    | 'depositAmount'
  >
): BookingPaymentDefaults => ({
  // The columns are NOT NULL in the schema, but every default below is also the
  // BEHAVIOUR-PRESERVING one, so a partially-populated row (an older read model,
  // a fixture) degrades to "take nothing" rather than to charging.
  defaultPaymentPolicy: org.defaultPaymentPolicy ?? 'in_clinic',
  defaultDepositBasis: org.defaultDepositBasis ?? 'fixed',
  // `deposit_amount` is the org-wide default amount and `deposit_enabled` is
  // its live on/off switch — not a legacy pair. The gate matters because an org
  // can turn deposits off and leave an amount behind, and a service that sets
  // `payment_policy: 'deposit'` with no amount of its own would otherwise pick
  // that stale figure back up and start charging it.
  defaultDepositAmountCents: org.depositEnabled
    ? (org.depositAmount ?? null)
    : null,
  defaultDepositPercent: org.defaultDepositPercent ?? null,
  depositAggregation: org.depositAggregation ?? 'sum',
});
