import { logError } from '@borradh-workspace/observability';
import Stripe from 'stripe';
import type {
  BillingPlan,
  CheckoutSessionResult,
  CreateCreditsCheckoutOptions,
  CreateSubscriptionCheckoutOptions,
  CreditPackage,
  CustomerPortalResult,
  InvoiceInfo,
  SubscriptionInfo,
  SubscriptionStatus,
} from './stripe.types.js';
import {
  DEFAULT_CREDIT_PACKAGES,
  DEFAULT_CURRENCY_PRICES,
  DEFAULT_PLAN,
} from './stripe.types.js';
import type { SupportedCurrency } from './stripe.types.js';

/**
 * Build plan configuration from environment variables
 */
function buildPlanFromEnv(): BillingPlan {
  const stripePriceId = process.env.STRIPE_PRICE_ID_PRO;
  console.log(
    '[StripeService] Building plan from env, STRIPE_PRICE_ID_PRO:',
    stripePriceId ? `${stripePriceId.substring(0, 10)}...` : 'NOT SET'
  );
  if (!stripePriceId) {
    throw new Error('STRIPE_PRICE_ID_PRO is required - check your .env file');
  }

  const includedCredits = process.env.STRIPE_INCLUDED_CREDITS
    ? Number.parseInt(process.env.STRIPE_INCLUDED_CREDITS, 10)
    : DEFAULT_PLAN.includedCredits;

  // Build currency prices map
  const currencyPrices: BillingPlan['currencyPrices'] = {
    usd: {
      stripePriceId,
      priceInCents: DEFAULT_CURRENCY_PRICES.usd,
    },
  };

  const eurPriceId = process.env.STRIPE_PRICE_ID_PRO_EUR;
  if (eurPriceId) {
    currencyPrices.eur = {
      stripePriceId: eurPriceId,
      priceInCents: DEFAULT_CURRENCY_PRICES.eur,
    };
  }

  const gbpPriceId = process.env.STRIPE_PRICE_ID_PRO_GBP;
  if (gbpPriceId) {
    currencyPrices.gbp = {
      stripePriceId: gbpPriceId,
      priceInCents: DEFAULT_CURRENCY_PRICES.gbp,
    };
  }

  return {
    ...DEFAULT_PLAN,
    stripePriceId,
    includedCredits,
    currencyPrices,
  };
}

/**
 * Build credit packages from environment variables
 */
function buildCreditPackagesFromEnv(): CreditPackage[] {
  return DEFAULT_CREDIT_PACKAGES.map((pkg) => {
    let stripePriceId = '';

    // Map package IDs to environment variable names
    if (pkg.id === 'credits-500') {
      stripePriceId = process.env.STRIPE_PRICE_ID_CREDITS_500 || '';
    } else if (pkg.id === 'credits-1000') {
      stripePriceId = process.env.STRIPE_PRICE_ID_CREDITS_1000 || '';
    } else if (pkg.id === 'credits-2500') {
      stripePriceId = process.env.STRIPE_PRICE_ID_CREDITS_2500 || '';
    }

    return {
      ...pkg,
      stripePriceId,
    };
  }).filter((pkg) => pkg.stripePriceId); // Only include packages with price IDs
}

export class StripeService {
  private stripe: Stripe;
  private plan: BillingPlan;
  private creditPackages: CreditPackage[];

  constructor(
    secretKey?: string,
    plan?: BillingPlan,
    creditPackages?: CreditPackage[]
  ) {
    const key = secretKey || process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }

    this.stripe = new Stripe(key, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    });

    this.plan = plan || buildPlanFromEnv();
    this.creditPackages = creditPackages || buildCreditPackagesFromEnv();
  }

  // ─────────────────────────────────────────────────────────────────
  // CUSTOMERS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create or retrieve a Stripe customer for an organization
   */
  async getOrCreateCustomer(
    organizationId: string,
    email: string,
    name: string,
    existingCustomerId?: string
  ): Promise<Stripe.Customer> {
    // If we have an existing customer ID, retrieve it
    if (existingCustomerId) {
      try {
        const customer =
          await this.stripe.customers.retrieve(existingCustomerId);
        if (!customer.deleted) {
          return customer as Stripe.Customer;
        }
      } catch {
        // Customer doesn't exist, create new one
      }
    }

    // Create new customer
    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: {
        organizationId,
      },
    });

    return customer;
  }

  /**
   * Update customer email
   */
  async updateCustomerEmail(
    customerId: string,
    email: string
  ): Promise<Stripe.Customer> {
    return this.stripe.customers.update(customerId, { email });
  }

  /**
   * Return the currency a customer is already locked to by Stripe (set after
   * their first subscription/invoice), if it's one we support. Returns null
   * when the customer has no locked currency yet or it can't be retrieved, so
   * callers fall back to the requested currency.
   */
  async getCustomerCurrency(
    customerId: string
  ): Promise<SupportedCurrency | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (customer.deleted) {
        return null;
      }
      const currency = customer.currency?.toLowerCase();
      if (currency === 'usd' || currency === 'eur' || currency === 'gbp') {
        return currency;
      }
    } catch {
      // Customer unreadable - fall back to the requested currency
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────
  // CHECKOUT SESSIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a checkout session for subscription
   */
  async createSubscriptionCheckout(
    options: CreateSubscriptionCheckoutOptions
  ): Promise<CheckoutSessionResult> {
    const {
      organizationId,
      customerEmail,
      successUrl,
      cancelUrl,
      customerId,
      trialDays,
      currency,
      metadata = {},
    } = options;

    // Resolve the currency for this checkout.
    // Stripe locks a customer to the currency of their first subscription/
    // invoice. Reusing that customer with a different currency throws
    // "You cannot combine currencies on a single customer". When we reuse an
    // existing customer, honor the currency they're already locked to rather
    // than the client-detected one.
    let resolvedCurrency: SupportedCurrency = currency || 'usd';
    if (customerId) {
      const lockedCurrency = await this.getCustomerCurrency(customerId);
      if (lockedCurrency && lockedCurrency !== resolvedCurrency) {
        resolvedCurrency = lockedCurrency;
      }
    }
    const currencyPrice = this.plan.currencyPrices[resolvedCurrency];
    const priceId = currencyPrice?.stripePriceId || this.plan.stripePriceId;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        organizationId,
        type: 'subscription',
        ...metadata,
      },
      subscription_data: {
        metadata: {
          organizationId,
          planId: this.plan.id,
        },
      },
    };

    // Use existing customer or provide email for auto-creation
    // Note: customer_creation is only valid for 'payment' mode
    // For 'subscription' mode, Stripe automatically creates the customer
    if (customerId) {
      sessionParams.customer = customerId;
    } else {
      sessionParams.customer_email = customerEmail;
    }

    // Add trial if specified
    if (trialDays && trialDays > 0 && sessionParams.subscription_data) {
      sessionParams.subscription_data.trial_period_days = trialDays;
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      throw new Error('Stripe checkout session URL not available');
    }

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Create a checkout session for purchasing credits
   */
  async createCreditsCheckout(
    options: CreateCreditsCheckoutOptions
  ): Promise<CheckoutSessionResult> {
    const {
      organizationId,
      customerId,
      creditPackageId,
      quantity = 1,
      successUrl,
      cancelUrl,
      metadata = {},
    } = options;

    const creditPackage = this.creditPackages.find(
      (p) => p.id === creditPackageId
    );
    if (!creditPackage) {
      throw new Error(`Credit package not found: ${creditPackageId}`);
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: creditPackage.priceInCents,
            product_data: {
              name: creditPackage.name,
              description: `${creditPackage.credits / 100} credits for SMS, email, voice, and WhatsApp`,
            },
          },
          quantity,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        organizationId,
        type: 'credits',
        creditPackageId,
        credits: String(creditPackage.credits * quantity),
        ...metadata,
      },
    });

    if (!session.url) {
      throw new Error('Stripe checkout session URL not available');
    }

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Retrieve a checkout session
   */
  async getCheckoutSession(
    sessionId: string
  ): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'subscription', 'line_items'],
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // CUSTOMER PORTAL
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a billing portal session for customer self-service
   */
  async createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<CustomerPortalResult> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return {
      url: session.url,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // SUBSCRIPTIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get subscription details
   */
  async getSubscription(
    subscriptionId: string
  ): Promise<SubscriptionInfo | null> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId,
        {
          expand: ['customer', 'default_payment_method'],
        }
      );

      return this.mapSubscription(subscription);
    } catch {
      return null;
    }
  }

  /**
   * Get subscription by customer ID
   */
  async getSubscriptionByCustomer(
    customerId: string
  ): Promise<SubscriptionInfo | null> {
    const subscriptions = await this.stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 1,
      expand: ['data.default_payment_method'],
    });

    if (subscriptions.data.length === 0) {
      return null;
    }

    return this.mapSubscription(subscriptions.data[0]);
  }

  /**
   * Cancel subscription at period end
   */
  async cancelSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
    const subscription = await this.stripe.subscriptions.update(
      subscriptionId,
      {
        cancel_at_period_end: true,
      }
    );

    return this.mapSubscription(subscription);
  }

  /**
   * Reactivate a subscription that was set to cancel
   */
  async reactivateSubscription(
    subscriptionId: string
  ): Promise<SubscriptionInfo> {
    const subscription = await this.stripe.subscriptions.update(
      subscriptionId,
      {
        cancel_at_period_end: false,
      }
    );

    return this.mapSubscription(subscription);
  }

  /**
   * Cancel subscription immediately
   */
  async cancelSubscriptionImmediately(
    subscriptionId: string
  ): Promise<SubscriptionInfo> {
    const subscription = await this.stripe.subscriptions.cancel(
      subscriptionId,
      {
        prorate: true,
      }
    );

    return this.mapSubscription(subscription);
  }

  private mapSubscription(subscription: Stripe.Subscription): SubscriptionInfo {
    return {
      id: subscription.id,
      status: subscription.status as SubscriptionStatus,
      customerId: subscription.customer as string,
      priceId: subscription.items.data[0]?.price.id || '',
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000)
        : null,
      endedAt: subscription.ended_at
        ? new Date(subscription.ended_at * 1000)
        : null,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // INVOICES
  // ─────────────────────────────────────────────────────────────────

  /**
   * List invoices for a customer
   */
  async listInvoices(customerId: string, limit = 10): Promise<InvoiceInfo[]> {
    const invoices = await this.stripe.invoices.list({
      customer: customerId,
      limit,
    });

    return invoices.data.map((invoice) => this.mapInvoice(invoice));
  }

  /**
   * Get a single invoice
   */
  async getInvoice(invoiceId: string): Promise<InvoiceInfo | null> {
    try {
      const invoice = await this.stripe.invoices.retrieve(invoiceId);
      return this.mapInvoice(invoice);
    } catch {
      return null;
    }
  }

  private mapInvoice(invoice: Stripe.Invoice): InvoiceInfo {
    return {
      id: invoice.id,
      customerId: invoice.customer as string,
      subscriptionId: invoice.subscription as string | null,
      amount: invoice.amount_due,
      currency: invoice.currency,
      status: invoice.status,
      paidAt: invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000)
        : null,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null,
      createdAt: new Date(invoice.created * 1000),
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // WEBHOOKS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Verify webhook signature and construct event
   */
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
    webhookSecret?: string
  ): Stripe.Event {
    const secret = webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required');
    }

    console.log(
      '[Stripe Webhook] Secret configured:',
      secret ? `${secret.substring(0, 10)}...` : 'NOT SET'
    );
    console.log(
      '[Stripe Webhook] Signature header:',
      signature ? `${signature.substring(0, 30)}...` : 'MISSING'
    );
    console.log(
      '[Stripe Webhook] Payload length:',
      typeof payload === 'string' ? payload.length : payload?.length
    );

    try {
      return this.stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (err) {
      logError('stripe.verifyWebhook', err, { feature: 'stripe' });
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // CONFIGURATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the current plan configuration
   */
  getPlan(): BillingPlan {
    return this.plan;
  }

  /**
   * Get available credit packages
   */
  getCreditPackages(): CreditPackage[] {
    return this.creditPackages;
  }

  /**
   * Get raw Stripe client for advanced operations
   */
  getClient(): Stripe {
    return this.stripe;
  }
}

// Singleton instance (lazy initialization)
let stripeService: StripeService | null = null;

export function getStripeService(): StripeService {
  if (!stripeService) {
    stripeService = new StripeService();
  }
  return stripeService;
}
