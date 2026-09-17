/**
 * Billing-specific error codes
 */
export const BillingErrorCodes = {
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  SUBSCRIPTION_ALREADY_EXISTS: 'SUBSCRIPTION_ALREADY_EXISTS',
  SUBSCRIPTION_INACTIVE: 'SUBSCRIPTION_INACTIVE',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  CREDIT_BALANCE_NOT_FOUND: 'CREDIT_BALANCE_NOT_FOUND',
  INVALID_CREDIT_PACKAGE: 'INVALID_CREDIT_PACKAGE',
  STRIPE_CUSTOMER_ERROR: 'STRIPE_CUSTOMER_ERROR',
  STRIPE_CHECKOUT_ERROR: 'STRIPE_CHECKOUT_ERROR',
  STRIPE_WEBHOOK_ERROR: 'STRIPE_WEBHOOK_ERROR',
  INVALID_WEBHOOK_SIGNATURE: 'INVALID_WEBHOOK_SIGNATURE',
  /**
   * A transient, RETRYABLE failure while processing an otherwise-valid webhook
   * (e.g. a database connection blip). The controller must return 5xx for this
   * so Stripe redelivers. Distinct from STRIPE_WEBHOOK_ERROR, which is treated
   * as a poison/non-retryable event and acknowledged with 2xx.
   */
  WEBHOOK_TRANSIENT_ERROR: 'WEBHOOK_TRANSIENT_ERROR',
} as const;

export type BillingErrorCode =
  (typeof BillingErrorCodes)[keyof typeof BillingErrorCodes];
