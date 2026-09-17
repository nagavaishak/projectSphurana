import type Stripe from 'stripe';

// Pre-fill data for Stripe Connect OAuth
export interface StripeConnectPrefillData {
  email?: string;
  url?: string;
  businessName?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
}

// Connected account info
export interface ConnectedAccountInfo {
  id: string;
  email: string | null;
  businessName: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string | null;
  defaultCurrency: string | null;
  requirementsCurrentlyDue: string[];
  disabledReason: string | null;
  /**
   * How the platform relates to this account, read from the live account
   * object rather than assumed. `controller` accounts are the ones we create
   * for embedded onboarding (no Stripe dashboard, Stripe collects
   * requirements); everything else — Standard accounts connected by OAuth or
   * by a shared Connect onboarding link, Express accounts — behaves like the
   * `standard_oauth` row type, including having a grant to revoke on
   * disconnect.
   */
  accountType: 'standard_oauth' | 'controller';
  /**
   * The Borradh organization this account has already been claimed by, taken
   * from account metadata (`borradh_organization_id`). Null for an account
   * that no org has linked yet. This is the only cross-org ownership signal
   * available on the API request path — RLS deliberately hides other orgs'
   * integration rows from it.
   */
  linkedOrganizationId: string | null;
}

// OAuth link result
export interface ConnectOAuthLinkResult {
  url: string;
  state: string;
}

// OAuth callback result
export interface ConnectOAuthCallbackResult {
  accountId: string;
  account: ConnectedAccountInfo;
}

// Account Link options (Stripe-hosted onboarding — redirect flow)
export interface CreateAccountLinkOptions {
  connectedAccountId: string;
  /** Where Stripe sends the user if the link expires or is revisited. */
  refreshUrl: string;
  /** Where Stripe returns the user once onboarding is submitted. */
  returnUrl: string;
  /** Which requirements to collect (defaults to currently_due). */
  collect?: 'currently_due' | 'eventually_due';
}

// Account Link result
export interface AccountLinkResult {
  url: string;
  /** Unix timestamp (seconds) after which the link is no longer usable. */
  expiresAt: number;
}

// Deposit checkout options
export interface CreateDepositCheckoutOptions {
  connectedAccountId: string;
  amountCents: number;
  currency?: string;
  productName?: string;
  productDescription?: string;
  /** Per-service Stripe Tax override; omitted means use the clinic preset. */
  taxCode?: string | null;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  metadata?: Record<string, string>;
  /**
   * Deterministic Stripe idempotency key (derive from an internal id) so a
   * retried create can't mint a second checkout session / charge.
   */
  idempotencyKey?: string;
}

// Deposit checkout result
export interface DepositCheckoutResult {
  sessionId: string;
  url: string;
}

// Payment checkout options (general-purpose, not tied to appointments)
export interface CreatePaymentCheckoutOptions {
  connectedAccountId: string;
  amountCents: number;
  currency?: string;
  description?: string;
  /** Optional Stripe Tax override; omitted means use the clinic preset. */
  taxCode?: string | null;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt?: Date;
  metadata?: Record<string, string>;
  /** Deterministic Stripe idempotency key (derive from an internal id). */
  idempotencyKey?: string;
}

// Payment checkout result
export interface PaymentCheckoutResult {
  sessionId: string;
  url: string;
}

/** A real retail basket: each row stays separate so Stripe Tax can classify it. */
export interface CreateShopCheckoutOptions {
  connectedAccountId: string;
  currency: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  metadata: Record<string, string>;
  idempotencyKey: string;
  lineItems: Array<{
    name: string;
    description?: string | null;
    image?: string | null;
    taxCode?: string | null;
    unitAmountCents: number;
    quantity: number;
  }>;
}

// Payment link options (persistent, reusable URLs)
export interface CreatePaymentLinkOptions {
  connectedAccountId: string;
  amountCents: number;
  currency?: string;
  productName: string;
  existingProductId?: string; // Reuse product if amount changes
  metadata?: Record<string, string>;
  /**
   * Deactivate the link after a single completed checkout
   * (`restrictions.completed_sessions.limit = 1`). Use for one-off tenders
   * like POS QR self-checkout so a customer can't scan-and-pay twice.
   */
  singleUse?: boolean;
  /**
   * Deterministic Stripe idempotency key (derive from an internal id) so a
   * retried create can't mint a duplicate payment link for the same tender.
   */
  idempotencyKey?: string;
}

// Payment link result
export interface PaymentLinkResult {
  paymentLinkId: string;
  paymentLinkUrl: string;
  productId: string;
}

// Refund options
export interface CreateRefundOptions {
  connectedAccountId: string;
  paymentIntentId: string;
  amountCents?: number; // If not provided, full refund
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent';
  /**
   * Deterministic Stripe idempotency key (derive from an internal id, e.g. the
   * payment/deposit row id) so a retried refund can't double-refund.
   */
  idempotencyKey?: string;
}

// Refund result
export interface RefundResult {
  id: string;
  amount: number;
  currency: string;
  status:
    | 'pending'
    | 'succeeded'
    | 'failed'
    | 'canceled'
    | 'requires_action'
    | null;
}

// ── Embedded Connect onboarding (controller accounts) ──────────────────

// Controller account creation options (contract §7.A)
export interface CreateControllerAccountOptions {
  /** ISO-3166 alpha-2 uppercase country, e.g. 'IE'. */
  country: string;
  email?: string;
  businessName?: string;
  /** business_profile.url. */
  websiteUrl?: string;
  /** ISO 4217 lowercase, from currencyForCountry. */
  defaultCurrency?: string;
  /**
   * Stripe idempotency key. Keyed on organizationId by the caller so two
   * concurrent "ensure account" requests can't create two acct_ objects.
   */
  idempotencyKey?: string;
}

export interface CreateControllerAccountResult {
  accountId: string;
  account: ConnectedAccountInfo;
}

export interface CreateAccountSessionOptions {
  connectedAccountId: string;
  /** Optional narrowing of the enabled embedded components. */
  components?: string[];
}

export interface AccountSessionResult {
  clientSecret: string;
}

/** A selectable Stripe Tax classification. IDs are opaque Stripe values. */
export interface StripeTaxCode {
  id: string;
  name: string;
  description: string;
}

/** The minimum Stripe Tax state required before Borradh enables Checkout Tax. */
export interface StripeTaxSettings {
  status: 'active' | 'pending';
  /** `inferred_by_currency` is Stripe's “Automatic” tax behaviour. */
  defaultTaxBehavior: 'exclusive' | 'inclusive' | 'inferred_by_currency' | null;
  defaultTaxCode: string | null;
}

// ── Stripe Terminal (contract §7.B) ─────────────────────────────────────

export interface ConnectionTokenResult {
  secret: string;
}

export interface CreateTerminalPaymentIntentOptions {
  connectedAccountId: string;
  amountCents: number;
  currency: string;
  metadata?: Record<string, string>;
  /**
   * Deterministic Stripe idempotency key (derive from an internal id, e.g. the
   * pending sale_payment row id) so a retried create can't open a second
   * PaymentIntent / double-charge the tender.
   */
  idempotencyKey?: string;
}

export interface TerminalPaymentIntentResult {
  id: string;
  clientSecret: string;
  status: string;
}

// Connect webhook event types
export type ConnectWebhookEventType =
  | 'checkout.session.completed'
  | 'checkout.session.expired'
  | 'charge.refunded'
  | 'account.updated'
  | 'account.application.deauthorized';

// Connect webhook event data
export interface ConnectWebhookEvent {
  type: ConnectWebhookEventType;
  account?: string; // Connected account ID
  data: {
    checkoutSession?: Stripe.Checkout.Session;
    charge?: Stripe.Charge;
    account?: Stripe.Account;
  };
}

// Recurring price options (membership plans — connected account)
export interface CreateRecurringPriceOptions {
  connectedAccountId: string;
  productName: string;
  /** Reuse an existing Stripe product instead of creating one. */
  existingProductId?: string;
  amountCents: number;
  currency?: string;
  interval: 'day' | 'week' | 'month' | 'year';
  intervalCount: number;
  metadata?: Record<string, string>;
}

// Recurring price result
export interface RecurringPriceResult {
  productId: string;
  priceId: string;
}

// Connected-account customer options
export interface CreateConnectedCustomerOptions {
  connectedAccountId: string;
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
}

// Connected-account subscription options
export interface CreateConnectedSubscriptionOptions {
  connectedAccountId: string;
  customerId: string;
  priceId: string;
  /**
   * End of the already-paid first period. Passed as Stripe `trial_end` so the
   * subscription's first invoice bills the RENEWAL, not period 1 (which the
   * in-store sale line already collected). `current_period_end` mirrors it.
   */
  trialEnd?: Date;
  metadata?: Record<string, string>;
  /**
   * Deterministic Stripe idempotency key (derive from an internal id, e.g.
   * leadId+planId) so a retried create can't open a second subscription.
   */
  idempotencyKey?: string;
}

// Connected-account subscription result
export interface ConnectedSubscriptionResult {
  subscriptionId: string;
  status: Stripe.Subscription.Status;
  currentPeriodEnd: Date | null;
}
