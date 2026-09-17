import type Stripe from 'stripe';

// Subscription statuses
export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'trialing'
  | 'unpaid'
  | 'paused';

// Credit purchase options
export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  priceInCents: number;
  stripePriceId: string;
}

// Supported currencies for subscription pricing
export type SupportedCurrency = 'usd' | 'eur' | 'gbp';

// Currency-specific price info
export interface CurrencyPrice {
  stripePriceId: string;
  priceInCents: number;
}

// Checkout session options
export interface CreateSubscriptionCheckoutOptions {
  organizationId: string;
  organizationName: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
  trialDays?: number;
  currency?: SupportedCurrency;
  metadata?: Record<string, string>;
}

export interface CreateCreditsCheckoutOptions {
  organizationId: string;
  customerId: string;
  creditPackageId: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

// Checkout session result
export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

// Customer portal result
export interface CustomerPortalResult {
  url: string;
}

// Subscription info
export interface SubscriptionInfo {
  id: string;
  status: SubscriptionStatus;
  customerId: string;
  priceId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
}

// Invoice info
export interface InvoiceInfo {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  amount: number;
  currency: string;
  status: Stripe.Invoice.Status | null;
  paidAt: Date | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  createdAt: Date;
}

// Webhook event types we care about
export type BillingWebhookEventType =
  | 'checkout.session.completed'
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'invoice.finalized'
  | 'charge.refunded';

// Webhook event data
export interface BillingWebhookEvent {
  type: BillingWebhookEventType;
  data: {
    checkoutSession?: Stripe.Checkout.Session;
    subscription?: Stripe.Subscription;
    invoice?: Stripe.Invoice;
  };
}

// Credit rates configuration
export interface CreditRates {
  sms: number;
  email: number;
  voicePerMinute: number;
  whatsapp: number;
}

// Default credit rates
export const DEFAULT_CREDIT_RATES: CreditRates = {
  sms: 100, // 1 credit = 100 units (for precision)
  email: 10, // 0.1 credits
  voicePerMinute: 500, // 5 credits
  whatsapp: 100, // 1 credit
};

// Credit channel types
export type CreditChannel = 'sms' | 'email' | 'voice' | 'whatsapp';

// Credit transaction types
export type CreditTransactionType =
  | 'subscription_refill'
  | 'purchase'
  | 'usage'
  | 'refund'
  | 'adjustment';

// Plan configuration
export interface BillingPlan {
  id: string;
  name: string;
  description: string;
  priceInCents: number;
  interval: 'month' | 'year';
  stripePriceId: string;
  includedCredits: number;
  features: string[];
  currencyPrices: Partial<Record<SupportedCurrency, CurrencyPrice>>;
}

// Default plan (can be overridden by config)
export const DEFAULT_PLAN: BillingPlan = {
  id: 'pro',
  name: 'Pro Plan',
  description: 'Full access to all features with monthly credits',
  priceInCents: 40000, // $400
  interval: 'month',
  stripePriceId: '', // Set via environment
  includedCredits: 100000, // 1000 credits (stored as cents for precision)
  features: [
    'Unlimited leads',
    'Automated sequences',
    'SMS, Email, WhatsApp, Voice',
    '1000 credits/month included',
    'Priority support',
  ],
  currencyPrices: {},
};

// Default display prices per currency (cents)
export const DEFAULT_CURRENCY_PRICES: Record<SupportedCurrency, number> = {
  usd: 40000, // $400
  eur: 36900, // €369 (including VAT for Ireland)
  gbp: 30000, // £300 (excl VAT for UK)
};

// Credit packages for purchase
export const DEFAULT_CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'credits-500',
    name: '500 Credits',
    credits: 50000, // 500 credits in cents
    priceInCents: 5000, // $50
    stripePriceId: '', // Set via environment
  },
  {
    id: 'credits-1000',
    name: '1000 Credits',
    credits: 100000, // 1000 credits in cents
    priceInCents: 9000, // $90 (10% discount)
    stripePriceId: '',
  },
  {
    id: 'credits-2500',
    name: '2500 Credits',
    credits: 250000, // 2500 credits in cents
    priceInCents: 20000, // $200 (20% discount)
    stripePriceId: '',
  },
];
