import { createHash, randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import type {
  AccountLinkResult,
  AccountSessionResult,
  ConnectOAuthCallbackResult,
  ConnectOAuthLinkResult,
  ConnectedAccountInfo,
  ConnectedSubscriptionResult,
  ConnectionTokenResult,
  CreateAccountLinkOptions,
  CreateAccountSessionOptions,
  CreateConnectedCustomerOptions,
  CreateConnectedSubscriptionOptions,
  CreateControllerAccountOptions,
  CreateControllerAccountResult,
  CreateDepositCheckoutOptions,
  CreatePaymentCheckoutOptions,
  CreatePaymentLinkOptions,
  CreateRecurringPriceOptions,
  CreateRefundOptions,
  CreateShopCheckoutOptions,
  CreateTerminalPaymentIntentOptions,
  DepositCheckoutResult,
  PaymentCheckoutResult,
  PaymentLinkResult,
  RecurringPriceResult,
  RefundResult,
  StripeTaxCode,
  StripeTaxSettings,
  TerminalPaymentIntentResult,
} from './stripe-connect.types.js';

/**
 * Did Stripe *refuse* a deauthorize request, as opposed to failing to serve it?
 *
 * `oauth.deauthorize` has a handful of outcomes we can neither retry nor fix in
 * code: the platform still owes a negative balance on the account, the grant is
 * already gone, or the account was never an OAuth grant at all. Stripe reports
 * all of them as 4xx (the negative-balance refusal comes back as a 401, so the
 * error class alone does not separate them from a bad API key — the status does
 * not, either, which is why callers pair this with the account-type gate).
 *
 * A 5xx, a timeout, or anything that is not a Stripe API error is Stripe being
 * unavailable rather than saying no, and stays a reportable error.
 */
export const isTerminalDeauthorizeRefusal = (error: unknown): boolean => {
  if (!(error instanceof Stripe.errors.StripeError)) return false;
  const status = error.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
};

/**
 * Metadata key stamped on every connected account Borradh claims, holding the
 * organization id that claimed it.
 *
 * It exists because the obvious ownership check — "is this acct_ already on
 * another org's integration row?" — cannot be made from the API request path:
 * that path connects as `app_authenticated`, which cannot see other orgs' rows
 * under RLS, so the query would return "unclaimed" for an account that is very
 * much claimed. Stripe itself is the one store both orgs can see.
 */
export const BORRADH_ORG_METADATA_KEY = 'borradh_organization_id';

/**
 * Did Stripe say it has no such connected account?
 *
 * An account id that is mistyped, belongs to a different platform, or was
 * never connected to us all come back the same way: a 4xx `resource_missing`
 * / permission error on `accounts.retrieve`. That is a bad input from the
 * person pasting the id, not a Borradh fault, so callers map it to NOT_FOUND
 * rather than logging it as an integration failure.
 */
export const isUnknownAccountError = (error: unknown): boolean => {
  if (!(error instanceof Stripe.errors.StripeError)) return false;
  if (error.code === 'resource_missing' || error.code === 'account_invalid') {
    return true;
  }
  const status = error.statusCode;
  return status === 403 || status === 404;
};

/**
 * Stripe-side detail worth keeping in the log line for a refused deauthorize,
 * so the reason stays queryable without an exception in Sentry.
 */
export const describeStripeError = (
  error: unknown
): Record<string, unknown> | undefined => {
  if (!(error instanceof Stripe.errors.StripeError)) return undefined;
  return {
    stripeErrorType: error.type,
    stripeRawType: error.rawType,
    stripeErrorCode: error.code,
    stripeStatusCode: error.statusCode,
    stripeRequestId: error.requestId,
  };
};

/** The connected clinic has not completed Stripe's separate Tax setup. */
export class StripeTaxSetupIncompleteError extends Error {
  constructor() {
    super(
      'Stripe Tax setup is incomplete. Add your tax registration and set tax behavior to Automatic in Tax Settings before taking online payments.'
    );
    this.name = 'StripeTaxSetupIncompleteError';
  }
}

export class StripeConnectService {
  // `protected` so StripeConnectStubService can swap in a throwing proxy; see
  // its constructor.
  protected stripe: Stripe;
  private clientId: string;

  constructor(secretKey?: string, clientId?: string) {
    const key = secretKey || process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }

    const cId = clientId || process.env.STRIPE_CONNECT_CLIENT_ID;
    if (!cId) {
      throw new Error('STRIPE_CONNECT_CLIENT_ID is required');
    }

    this.stripe = new Stripe(key, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    });
    this.clientId = cId;
  }

  // ─────────────────────────────────────────────────────────────────
  // OAUTH FLOW
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate OAuth URL for Standard Connect accounts
   */
  generateOAuthLink(
    redirectUri: string,
    state: string,
    organizationEmail?: string
  ): ConnectOAuthLinkResult {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: 'read_write',
      redirect_uri: redirectUri,
      state,
    });

    if (organizationEmail) {
      params.set('stripe_user[email]', organizationEmail);
    }

    const url = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;

    return { url, state };
  }

  /**
   * The REUSABLE onboarding link — the one that can be emailed.
   *
   * Unlike `generateOAuthLink` there is no `state`, because there is no session
   * to bind it to: this link is handed out before the merchant has a Borradh
   * account at all. That is also why it can be sent, bookmarked, forwarded and
   * used by many businesses, where an Account Link cannot: Account Links are
   * single-use, expire in minutes, need the account to exist first, and Stripe
   * asks platforms not to send them outside the application (a link preview in
   * a messaging client burns one before the merchant clicks).
   *
   * `redirectUri` must be registered in the platform's Stripe OAuth settings,
   * and must point at the ORG-LESS callback — the org-scoped one rejects a
   * state-less request, which is the correct behaviour there and a dead end
   * here.
   */
  selfServeOnboardingUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: 'read_write',
      redirect_uri: redirectUri,
    });
    return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange OAuth code for connected account ID
   */
  async handleOAuthCallback(code: string): Promise<ConnectOAuthCallbackResult> {
    const response = await this.stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    if (!response.stripe_user_id) {
      throw new Error('No Stripe account ID returned from OAuth');
    }

    const account = await this.getAccountInfo(response.stripe_user_id);

    return {
      accountId: response.stripe_user_id,
      account,
    };
  }

  /**
   * Drop the ownership stamp `claimAccount` wrote, so the account can later be
   * linked to a different workspace.
   *
   * Called on disconnect. Without it the stamp outlives the connection and a
   * merchant who legitimately moves workspaces is refused forever — the guard
   * would be protecting a relationship that no longer exists. Stripe deletes a
   * metadata key when its value is set to the empty string.
   *
   * Must run BEFORE `disconnectAccount` on a Standard account: revoking the
   * grant first also revokes our ability to write the account.
   */
  async releaseAccount(accountId: string): Promise<void> {
    await this.stripe.accounts.update(accountId, {
      metadata: { [BORRADH_ORG_METADATA_KEY]: '' },
    });
  }

  /**
   * Revoke the platform's OAuth grant on a Standard connected account.
   *
   * ONLY valid for `standard_oauth` accounts. Controller accounts created by
   * embedded onboarding have no OAuth grant to revoke — Stripe rejects them
   * outright ("V2 Accounts cannot be disconnected via this endpoint"), so
   * callers must gate on `stripe_connect_integration.account_type` rather than
   * calling this and swallowing the failure.
   *
   * Stripe can still refuse a legitimate revocation (most commonly when the
   * platform is on the hook for a negative balance). Those refusals are
   * terminal, not transient — see `isTerminalDeauthorizeRefusal`.
   */
  async disconnectAccount(accountId: string): Promise<void> {
    await this.stripe.oauth.deauthorize({
      client_id: this.clientId,
      stripe_user_id: accountId,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // ACCOUNT MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get connected account information
   */
  async getAccountInfo(accountId: string): Promise<ConnectedAccountInfo> {
    const account = await this.stripe.accounts.retrieve(accountId);
    return this.mapAccount(account);
  }

  /**
   * Refresh account status from Stripe
   */
  async refreshAccountStatus(accountId: string): Promise<ConnectedAccountInfo> {
    return this.getAccountInfo(accountId);
  }

  /**
   * Stamp the owning organization onto the connected account's metadata, so a
   * later attempt to link the same account to a DIFFERENT org can be refused
   * (see `BORRADH_ORG_METADATA_KEY`).
   *
   * Metadata is the only field written here — nothing about how the account
   * charges, pays out, or verifies is touched.
   */
  async claimAccount(accountId: string, organizationId: string): Promise<void> {
    await this.stripe.accounts.update(accountId, {
      metadata: { [BORRADH_ORG_METADATA_KEY]: organizationId },
    });
  }

  private mapAccount(account: Stripe.Account): ConnectedAccountInfo {
    return {
      id: account.id,
      email: account.email ?? null,
      businessName: account.business_profile?.name ?? null,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
      country: account.country ?? null,
      defaultCurrency: account.default_currency ?? null,
      requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? null,
      accountType:
        account.controller?.stripe_dashboard?.type === 'none'
          ? 'controller'
          : 'standard_oauth',
      linkedOrganizationId:
        account.metadata?.[BORRADH_ORG_METADATA_KEY] ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // EMBEDDED CONNECT ONBOARDING (controller accounts — contract §7.A)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a controller account for embedded Connect onboarding.
   * Replaces OAuth for NEW orgs; legacy Standard OAuth accounts keep the
   * existing path (dual-path, discriminated by
   * stripe_connect_integration.account_type).
   */
  async createControllerAccount(
    options: CreateControllerAccountOptions
  ): Promise<CreateControllerAccountResult> {
    const {
      country,
      email,
      businessName,
      websiteUrl,
      defaultCurrency,
      idempotencyKey,
    } = options;

    const params: Stripe.AccountCreateParams = {
      controller: {
        stripe_dashboard: { type: 'none' },
        fees: { payer: 'application' },
        // Stripe requires that when the dashboard is `none` and Stripe collects
        // requirements, Stripe is liable for negative balances / refunds /
        // chargebacks — so losses.payments must be `stripe` (not `application`).
        losses: { payments: 'stripe' },
        requirement_collection: 'stripe',
      },
      // A controller account with Stripe-collected requirements must request
      // its capabilities up front; onboarding then collects what they need.
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      country,
      business_profile: {
        mcc: '7230',
        name: businessName,
        url: websiteUrl,
      },
    };
    if (email) params.email = email;
    if (defaultCurrency) params.default_currency = defaultCurrency;

    // The idempotency key (org-scoped by the caller) prevents duplicate acct_
    // objects when concurrent requests race. We append a hash of the params so
    // that any change to the account config produces a fresh key — Stripe
    // rejects reusing a key with different params, and a stale/failed attempt
    // would otherwise lock the org's key to the old config.
    const scopedKey = idempotencyKey
      ? `${idempotencyKey}:${createHash('sha256')
          .update(JSON.stringify(params))
          .digest('hex')
          .slice(0, 16)}`
      : undefined;
    const account = await this.stripe.accounts.create(
      params,
      scopedKey ? { idempotencyKey: scopedKey } : undefined
    );

    return {
      accountId: account.id,
      account: this.mapAccount(account),
    };
  }

  /**
   * Create an Account Session for the embedded Connect components.
   * Enables exactly: account_onboarding, notification_banner,
   * payouts, balances, payment_details, tax settings and tax registrations —
   * unless narrowed via `components`.
   */
  async createAccountSession(
    options: CreateAccountSessionOptions
  ): Promise<AccountSessionResult> {
    const { connectedAccountId, components } = options;

    const allComponents: Stripe.AccountSessionCreateParams.Components = {
      account_onboarding: { enabled: true },
      notification_banner: { enabled: true },
      payouts: { enabled: true },
      balances: { enabled: true },
      payment_details: { enabled: true },
      tax_settings: { enabled: true },
      tax_registrations: { enabled: true },
    };

    let enabled: Stripe.AccountSessionCreateParams.Components = allComponents;
    if (components && components.length > 0) {
      enabled = Object.fromEntries(
        Object.entries(allComponents).filter(([key]) =>
          components.includes(key)
        )
      );
    }

    const session = await this.stripe.accountSessions.create({
      account: connectedAccountId,
      components: enabled,
    });

    return { clientSecret: session.client_secret };
  }

  /**
   * Lists Stripe's authoritative product/service classifications. The IDs must
   * be passed through unchanged: Stripe explicitly treats them as opaque.
   */
  async listTaxCodes(): Promise<StripeTaxCode[]> {
    const taxCodes = await this.stripe.taxCodes
      .list({ limit: 100 })
      .autoPagingToArray({ limit: 10_000 });

    return taxCodes.map(({ id, name, description }) => ({
      id,
      name,
      description,
    }));
  }

  /** Read the connected clinic's Stripe-owned Tax Settings. */
  async getTaxSettings(connectedAccountId: string): Promise<StripeTaxSettings> {
    const settings = await this.stripe.tax.settings.retrieve(
      {},
      { stripeAccount: connectedAccountId }
    );
    return {
      status: settings.status,
      defaultTaxBehavior: settings.defaults.tax_behavior,
      defaultTaxCode: settings.defaults.tax_code,
    };
  }

  /**
   * Stripe returns a valid-looking zero-tax Checkout session when the merchant
   * has not completed Tax setup. Refuse to create one instead: silently
   * under-collecting tax is materially worse than making setup explicit.
   */
  private async assertTaxSetupActive(
    connectedAccountId: string
  ): Promise<void> {
    const settings = await this.getTaxSettings(connectedAccountId);
    if (
      settings.status !== 'active' ||
      settings.defaultTaxBehavior !== 'inferred_by_currency'
    ) {
      throw new StripeTaxSetupIncompleteError();
    }
  }

  /**
   * Create an Account Link for Stripe-hosted onboarding. Returns a URL to
   * redirect the merchant to Stripe's own onboarding flow (no embedded
   * iframe). `return_url` is where Stripe sends them back once submitted;
   * `refresh_url` is used if the (single-use, short-lived) link expires.
   */
  async createAccountLink(
    options: CreateAccountLinkOptions
  ): Promise<AccountLinkResult> {
    const {
      connectedAccountId,
      refreshUrl,
      returnUrl,
      collect = 'currently_due',
    } = options;

    const link = await this.stripe.accountLinks.create({
      account: connectedAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
      collection_options: { fields: collect },
    });

    return { url: link.url, expiresAt: link.expires_at };
  }

  // ─────────────────────────────────────────────────────────────────
  // STRIPE TERMINAL (contract §7.B)
  // ─────────────────────────────────────────────────────────────────

  /** Connection token for the Terminal SDK on the connected account. */
  async createTerminalConnectionToken(
    connectedAccountId: string
  ): Promise<ConnectionTokenResult> {
    const token = await this.stripe.terminal.connectionTokens.create(
      {},
      { stripeAccount: connectedAccountId }
    );
    return { secret: token.secret };
  }

  /**
   * PaymentIntent for in-person Tap to Pay tenders: card_present, automatic
   * capture. Reader-driven collect/confirm happens client-side via the Tap to
   * Pay SDK.
   */
  async createTerminalPaymentIntent(
    options: CreateTerminalPaymentIntentOptions
  ): Promise<TerminalPaymentIntentResult> {
    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: options.amountCents,
        currency: options.currency,
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        metadata: options.metadata,
      },
      this.connectRequestOptions(
        options.connectedAccountId,
        options.idempotencyKey
      )
    );
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret ?? '',
      status: paymentIntent.status,
    };
  }

  /**
   * Retrieve a PaymentIntent's current status on a connected account. Used to
   * settle a manual-card tender the moment Elements confirms it, without
   * waiting on the async webhook.
   */
  async retrievePaymentIntentStatus(
    connectedAccountId: string,
    paymentIntentId: string
  ): Promise<{ id: string; status: string }> {
    const paymentIntent = await this.stripe.paymentIntents.retrieve(
      paymentIntentId,
      { stripeAccount: connectedAccountId }
    );
    return { id: paymentIntent.id, status: paymentIntent.status };
  }

  /**
   * Create a card (card-not-present) PaymentIntent on a connected account for
   * manual card entry — the client secret is confirmed client-side with Stripe
   * Elements. Restricted to `card` so the PaymentElement renders a keyed card
   * form (no redirect-based methods).
   */
  async createCardPaymentIntent(
    options: CreateTerminalPaymentIntentOptions
  ): Promise<TerminalPaymentIntentResult> {
    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: options.amountCents,
        currency: options.currency,
        payment_method_types: ['card'],
        capture_method: 'automatic',
        metadata: options.metadata,
      },
      this.connectRequestOptions(
        options.connectedAccountId,
        options.idempotencyKey
      )
    );
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret ?? '',
      status: paymentIntent.status,
    };
  }

  /** Manual-capture fallback for Terminal PaymentIntents. */
  async captureTerminalPaymentIntent(
    connectedAccountId: string,
    paymentIntentId: string
  ): Promise<TerminalPaymentIntentResult> {
    const paymentIntent = await this.stripe.paymentIntents.capture(
      paymentIntentId,
      {},
      { stripeAccount: connectedAccountId }
    );
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret ?? '',
      status: paymentIntent.status,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // DEPOSIT CHECKOUT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a checkout session for deposit payment on a connected account
   */
  async createDepositCheckout(
    options: CreateDepositCheckoutOptions
  ): Promise<DepositCheckoutResult> {
    const {
      connectedAccountId,
      amountCents,
      currency = 'usd',
      productName = 'Appointment Deposit',
      productDescription,
      taxCode,
      successUrl,
      cancelUrl,
      expiresAt,
      metadata = {},
    } = options;

    // Calculate expiration timestamp (must be between 30 min and 24 hours in the future)
    const now = Math.floor(Date.now() / 1000);
    let expiresAtTimestamp = Math.floor(expiresAt.getTime() / 1000);

    // Stripe requires expires_at to be at least 30 minutes in the future
    const minExpiration = now + 30 * 60; // 30 minutes
    const maxExpiration = now + 24 * 60 * 60; // 24 hours

    if (expiresAtTimestamp < minExpiration) {
      expiresAtTimestamp = minExpiration;
    }
    if (expiresAtTimestamp > maxExpiration) {
      expiresAtTimestamp = maxExpiration;
    }

    await this.assertTaxSetupActive(connectedAccountId);

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        automatic_tax: { enabled: true },
        line_items: [
          {
            price_data: {
              currency,
              product_data: {
                name: productName,
                description: productDescription,
                ...(taxCode ? { tax_code: taxCode } : {}),
              },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        expires_at: expiresAtTimestamp,
        metadata: {
          type: 'appointment_deposit',
          ...metadata,
        },
        // Future: Add platform fee
        // payment_intent_data: {
        //   application_fee_amount: Math.round(amountCents * 0.029) + 30,
        // },
      },
      // Creates session on connected account; idempotency-keyed so a retried
      // deposit request can't open a second checkout session.
      this.connectRequestOptions(connectedAccountId, options.idempotencyKey)
    );

    if (!session.url) {
      throw new Error('Stripe checkout session URL not available');
    }

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Create a general-purpose payment checkout session on a connected account.
   * Unlike deposit checkout, this is not tied to an appointment.
   */
  async createPaymentCheckout(
    options: CreatePaymentCheckoutOptions
  ): Promise<PaymentCheckoutResult> {
    const {
      connectedAccountId,
      amountCents,
      currency = 'eur',
      description = 'Payment',
      taxCode,
      customerEmail,
      successUrl,
      cancelUrl,
      expiresAt,
      metadata = {},
    } = options;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      automatic_tax: { enabled: true },
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: description,
              ...(taxCode ? { tax_code: taxCode } : {}),
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        type: 'payment',
        ...metadata,
      },
    };

    if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    if (expiresAt) {
      const now = Math.floor(Date.now() / 1000);
      let expiresAtTimestamp = Math.floor(expiresAt.getTime() / 1000);
      const minExpiration = now + 30 * 60;
      const maxExpiration = now + 24 * 60 * 60;
      if (expiresAtTimestamp < minExpiration)
        expiresAtTimestamp = minExpiration;
      if (expiresAtTimestamp > maxExpiration)
        expiresAtTimestamp = maxExpiration;
      sessionParams.expires_at = expiresAtTimestamp;
    }

    await this.assertTaxSetupActive(connectedAccountId);

    const session = await this.stripe.checkout.sessions.create(
      sessionParams,
      this.connectRequestOptions(connectedAccountId, options.idempotencyKey)
    );

    if (!session.url) {
      throw new Error('Stripe checkout session URL not available');
    }

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Retail checkout must not collapse a basket into one opaque amount: Stripe
   * Tax classifies each product line independently.
   */
  async createShopCheckout(
    options: CreateShopCheckoutOptions
  ): Promise<PaymentCheckoutResult> {
    await this.assertTaxSetupActive(options.connectedAccountId);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Math.max(
      now + 30 * 60,
      Math.min(
        now + 24 * 60 * 60,
        Math.floor(options.expiresAt.getTime() / 1000)
      )
    );
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        automatic_tax: { enabled: true },
        // Retail collection has no delivery address, so collect billing
        // address at Checkout. Stripe Tax needs a customer location to
        // calculate the correct jurisdiction and rate.
        billing_address_collection: 'required',
        customer_email: options.customerEmail,
        line_items: options.lineItems.map((line) => ({
          price_data: {
            currency: options.currency,
            product_data: {
              name: line.name,
              ...(line.description ? { description: line.description } : {}),
              ...(line.image ? { images: [line.image] } : {}),
              ...(line.taxCode ? { tax_code: line.taxCode } : {}),
            },
            unit_amount: line.unitAmountCents,
          },
          quantity: line.quantity,
        })),
        success_url: options.successUrl,
        cancel_url: options.cancelUrl,
        expires_at: expiresAt,
        metadata: { type: 'shop_order', ...options.metadata },
      },
      this.connectRequestOptions(
        options.connectedAccountId,
        options.idempotencyKey
      )
    );
    if (!session.url)
      throw new Error('Stripe checkout session URL not available');
    return { sessionId: session.id, url: session.url };
  }

  /**
   * Retrieve checkout session from connected account
   */
  async getCheckoutSession(
    connectedAccountId: string,
    sessionId: string
  ): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(
      sessionId,
      {
        expand: ['payment_intent'],
      },
      {
        stripeAccount: connectedAccountId,
      }
    );
  }

  /**
   * Expire a checkout session (cancel it)
   */
  async expireCheckoutSession(
    connectedAccountId: string,
    sessionId: string
  ): Promise<void> {
    await this.stripe.checkout.sessions.expire(sessionId, {
      stripeAccount: connectedAccountId,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // REFUNDS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a refund on a connected account
   */
  async createRefund(options: CreateRefundOptions): Promise<RefundResult> {
    const { connectedAccountId, paymentIntentId, amountCents, reason } =
      options;

    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
    };

    if (amountCents !== undefined) {
      refundParams.amount = amountCents;
    }

    if (reason) {
      refundParams.reason = reason;
    }

    const refund = await this.stripe.refunds.create(
      refundParams,
      // Idempotency-keyed so a retried refund can't refund the same tender twice.
      this.connectRequestOptions(connectedAccountId, options.idempotencyKey)
    );

    return {
      id: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status as RefundResult['status'],
    };
  }

  /**
   * Cancel a PaymentIntent on a connected account. Used to close an abandoned
   * pending tender (uncollected terminal PI / unconfirmed manual-card PI) when a
   * sale is completed or voided by other means — otherwise a late capture would
   * be money we never record locally. Throws if the PI is no longer cancelable
   * (e.g. already succeeded); callers treat this as best-effort.
   */
  async cancelPaymentIntent(
    connectedAccountId: string,
    paymentIntentId: string
  ): Promise<{ id: string; status: string }> {
    const paymentIntent = await this.stripe.paymentIntents.cancel(
      paymentIntentId,
      {},
      { stripeAccount: connectedAccountId }
    );
    return { id: paymentIntent.id, status: paymentIntent.status };
  }

  // ─────────────────────────────────────────────────────────────────
  // PAYMENT LINKS (persistent, reusable URLs)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a Payment Link on a connected account.
   * Creates a Product + Price + Payment Link.
   * Reuses an existing product if `existingProductId` is provided.
   */
  async createPaymentLink(
    options: CreatePaymentLinkOptions
  ): Promise<PaymentLinkResult> {
    const {
      connectedAccountId,
      amountCents,
      currency = 'eur',
      productName,
      existingProductId,
      metadata = {},
      singleUse = false,
      idempotencyKey,
    } = options;

    const stripeAccount = { stripeAccount: connectedAccountId };

    // Create or reuse product
    let productId: string;
    if (existingProductId) {
      productId = existingProductId;
    } else {
      const product = await this.stripe.products.create(
        { name: productName, metadata: { type: 'deposit', ...metadata } },
        stripeAccount
      );
      productId = product.id;
    }

    // Create a new price for the product
    const price = await this.stripe.prices.create(
      {
        product: productId,
        unit_amount: amountCents,
        currency,
      },
      stripeAccount
    );

    // Create the payment link. `singleUse` caps it to one completed checkout
    // so a one-off tender (e.g. POS QR self-checkout) can't be paid twice —
    // Stripe deactivates the link once the session limit is reached.
    const paymentLink = await this.stripe.paymentLinks.create(
      {
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: { type: 'service_deposit', ...metadata },
        ...(singleUse
          ? { restrictions: { completed_sessions: { limit: 1 } } }
          : {}),
      },
      // Idempotency-keyed so a retried tender can't mint a duplicate link.
      this.connectRequestOptions(connectedAccountId, idempotencyKey)
    );

    return {
      paymentLinkId: paymentLink.id,
      paymentLinkUrl: paymentLink.url,
      productId,
    };
  }

  /**
   * Deactivate a Payment Link on a connected account.
   */
  async deactivatePaymentLink(
    connectedAccountId: string,
    paymentLinkId: string
  ): Promise<void> {
    await this.stripe.paymentLinks.update(
      paymentLinkId,
      { active: false },
      { stripeAccount: connectedAccountId }
    );
  }

  /**
   * Expire every still-OPEN Checkout Session created from a Payment Link.
   *
   * Deactivating a link (`active: false`) only stops NEW scans — a customer who
   * already scanned holds an open session that stays payable (~24h) until it's
   * expired. Abandoning a QR tender must expire those open sessions too, or the
   * client could pay a tender the cashier already moved on from (charged, but
   * the webhook then ignores the now-`failed` row → captured-but-unrecorded).
   *
   * Per-session best-effort: a session that COMPLETED in the race window can't
   * be expired (Stripe throws) — it's left for the webhook, which settles the
   * still-`pending` row before abandonment marks it failed.
   */
  async expireOpenPaymentLinkSessions(
    connectedAccountId: string,
    paymentLinkId: string
  ): Promise<void> {
    const sessions = await this.stripe.checkout.sessions.list(
      { payment_link: paymentLinkId, status: 'open', limit: 100 },
      { stripeAccount: connectedAccountId }
    );
    for (const session of sessions.data) {
      try {
        await this.stripe.checkout.sessions.expire(session.id, {
          stripeAccount: connectedAccountId,
        });
      } catch {
        // Already completed/expired between the list and the expire — the
        // completion webhook settles the (still-pending) row; nothing to do.
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // SUBSCRIPTIONS (connected account — recurring memberships)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create (or reuse) a Product and create a recurring Price on a connected
   * account. Used for recurring membership plans — the price is created
   * lazily the first time a recurring plan is sold.
   */
  async createRecurringPrice(
    options: CreateRecurringPriceOptions
  ): Promise<RecurringPriceResult> {
    const {
      connectedAccountId,
      productName,
      existingProductId,
      amountCents,
      currency = 'eur',
      interval,
      intervalCount,
      metadata = {},
    } = options;

    const stripeAccount = { stripeAccount: connectedAccountId };

    let productId: string;
    if (existingProductId) {
      productId = existingProductId;
    } else {
      const product = await this.stripe.products.create(
        {
          name: productName,
          metadata: { type: 'membership_plan', ...metadata },
        },
        stripeAccount
      );
      productId = product.id;
    }

    const price = await this.stripe.prices.create(
      {
        product: productId,
        unit_amount: amountCents,
        currency,
        recurring: {
          interval,
          interval_count: intervalCount,
        },
        metadata,
      },
      stripeAccount
    );

    return { productId, priceId: price.id };
  }

  /**
   * Create a customer on a connected account (the membership purchaser).
   */
  async createConnectedCustomer(
    options: CreateConnectedCustomerOptions
  ): Promise<{ customerId: string }> {
    const { connectedAccountId, email, name, metadata = {} } = options;

    const customer = await this.stripe.customers.create(
      {
        ...(email ? { email } : {}),
        ...(name ? { name } : {}),
        metadata,
      },
      { stripeAccount: connectedAccountId }
    );

    return { customerId: customer.id };
  }

  /**
   * Create a subscription on a connected account for a recurring membership.
   * Billing is invoice-based (`send_invoice`) so the sale can be settled
   * in-store by any tender; Stripe emails the invoice for renewals.
   */
  async createConnectedSubscription(
    options: CreateConnectedSubscriptionOptions
  ): Promise<ConnectedSubscriptionResult> {
    const {
      connectedAccountId,
      customerId,
      priceId,
      trialEnd,
      metadata = {},
      idempotencyKey,
    } = options;

    const params: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId }],
      // TODO(renewals): switch to `collection_method: 'charge_automatically'`
      // once we save a card on the connected customer at sale time. Until a
      // payment method is on file, `send_invoice` is required — automatic
      // charging with no default payment method fails the subscription. Do
      // not flip this without also persisting a saved card + default PM.
      collection_method: 'send_invoice',
      days_until_due: 7,
      metadata: { type: 'membership', ...metadata },
    };

    // The in-store sale line already collects period 1 at checkout. Anchor the
    // subscription's first billing at the end of period 1 (via `trial_end`) so
    // Stripe only invoices RENEWALS — otherwise its first invoice double-bills
    // period 1. `current_period_end` then mirrors this trial end.
    if (trialEnd) {
      params.trial_end = Math.floor(trialEnd.getTime() / 1000);
    }

    const subscription = await this.stripe.subscriptions.create(
      params,
      // Idempotency-keyed so a retried purchase can't open a second subscription.
      this.connectRequestOptions(connectedAccountId, idempotencyKey)
    );

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
    };
  }

  /**
   * Cancel a subscription on a connected account (immediate cancellation).
   */
  async cancelConnectedSubscription(
    connectedAccountId: string,
    subscriptionId: string
  ): Promise<{ status: Stripe.Subscription.Status }> {
    const subscription = await this.stripe.subscriptions.cancel(
      subscriptionId,
      {},
      { stripeAccount: connectedAccountId }
    );

    return { status: subscription.status };
  }

  // ─────────────────────────────────────────────────────────────────
  // WEBHOOKS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Verify Connect webhook signature and construct event
   */
  constructConnectWebhookEvent(
    payload: string | Buffer,
    signature: string,
    webhookSecret?: string
  ): Stripe.Event {
    const secret = webhookSecret || process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('STRIPE_CONNECT_WEBHOOK_SECRET is required');
    }

    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }

  // ─────────────────────────────────────────────────────────────────
  // RAW CLIENT ACCESS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Build Stripe request options for a connected-account call, optionally
   * attaching a deterministic idempotency key. A retried money-moving call
   * carrying the same key returns Stripe's cached first response instead of
   * charging/refunding again. Keys are scoped per connected account, so an
   * internal-id-derived key is safe to reuse across orgs.
   */
  private connectRequestOptions(
    connectedAccountId: string,
    idempotencyKey?: string
  ): Stripe.RequestOptions {
    return idempotencyKey
      ? { stripeAccount: connectedAccountId, idempotencyKey }
      : { stripeAccount: connectedAccountId };
  }

  /**
   * Get raw Stripe client for advanced operations
   */
  getClient(): Stripe {
    return this.stripe;
  }
}

/**
 * E2E stub for the Connect service. Enabled by `STRIPE_E2E_STUB=true` (preview /
 * local E2E hosts ONLY — never production). Overrides every outbound Stripe call
 * a POS / deposit / membership tender makes so the browser E2E suite can drive
 * the full UI→settlement→completed-sale leg without real Stripe: `create*`
 * methods return deterministic ids, and `retrievePaymentIntentStatus` reports
 * `succeeded` so `settleCardPayment` closes a manual-card sale synchronously (no
 * webhook needed). Async tenders (terminal / QR / deposit / subscription) are
 * then settled by injecting the corresponding event through
 * `POST /testing/simulate-stripe-webhook`, which calls the same settlement
 * services as the real webhook router. Kept in-file to avoid a circular
 * `service ↔ stub` import (the `extends` would hit a TDZ ReferenceError).
 *
 * EVERY method that would reach the network must be overridden here. The stub
 * extends the real service, so anything left un-overridden silently runs the
 * real implementation against `sk_test_e2e_stub` and fails with Stripe's
 * "Invalid API Key provided: sk_test_****stub" — which reads as a config
 * incident but is really an untested code path. `stub-coverage.test.ts` fails
 * the build when a new outbound method is added without an override, and the
 * base client is proxied below so any remaining gap throws by name instead of
 * making the call.
 */
class StripeConnectStubService extends StripeConnectService {
  constructor() {
    // Dummy keys so the base constructor's `new Stripe(...)` succeeds without
    // real credentials.
    super('sk_test_e2e_stub', 'ca_e2e_stub');

    // Backstop for the gap this class had for months: an un-overridden method
    // reached real Stripe with the dummy key, and the resulting auth error was
    // indistinguishable from a live test key in a production secret. Trap the
    // client so a miss fails loudly, at the call site, naming the resource.
    this.stripe = new Proxy({} as Stripe, {
      get(_target, resource) {
        throw new Error(
          `StripeConnectStubService made a real Stripe call (stripe.${String(resource)}). Every outbound method must be overridden on the stub — add one.`
        );
      },
    });
  }

  private stubId(prefix: string): string {
    return `${prefix}_e2e_${randomUUID().replace(/-/g, '')}`;
  }

  /** Deterministic account snapshot — fully onboarded, so the UI shows "Active". */
  private stubAccount(accountId: string): ConnectedAccountInfo {
    return {
      id: accountId,
      email: 'e2e@example.com',
      businessName: 'E2E Stub Account',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      country: 'IE',
      defaultCurrency: 'eur',
      requirementsCurrentlyDue: [],
      disabledReason: null,
      accountType: 'controller',
      linkedOrganizationId: null,
    };
  }

  override async claimAccount(
    _accountId: string,
    _organizationId: string
  ): Promise<void> {
    // Nothing to stamp on a stub account.
  }

  override async releaseAccount(_accountId: string): Promise<void> {
    // Nothing to clear on a stub account.
  }

  override selfServeOnboardingUrl(_redirectUri: string): string {
    return 'https://connect.stripe.com/oauth/authorize?client_id=ca_e2e_stub';
  }

  override async handleOAuthCallback(
    _code: string
  ): Promise<ConnectOAuthCallbackResult> {
    const accountId = this.stubId('acct');
    return { accountId, account: this.stubAccount(accountId) };
  }

  override async disconnectAccount(_accountId: string): Promise<void> {
    // No grant to revoke against a stub.
  }

  override async getAccountInfo(
    accountId: string
  ): Promise<ConnectedAccountInfo> {
    return this.stubAccount(accountId);
  }

  override async createControllerAccount(
    _options: CreateControllerAccountOptions
  ): Promise<CreateControllerAccountResult> {
    const accountId = this.stubId('acct');
    return { accountId, account: this.stubAccount(accountId) };
  }

  override async createAccountSession(
    _options: CreateAccountSessionOptions
  ): Promise<AccountSessionResult> {
    return { clientSecret: `${this.stubId('accs')}_secret_e2e` };
  }

  override async listTaxCodes(): Promise<StripeTaxCode[]> {
    return [
      {
        id: 'txcd_99999999',
        name: 'General - Tangible Goods',
        description: 'Any tangible or physical good.',
      },
    ];
  }

  override async getTaxSettings(
    _connectedAccountId: string
  ): Promise<StripeTaxSettings> {
    return {
      status: 'active',
      defaultTaxBehavior: 'inferred_by_currency',
      defaultTaxCode: 'txcd_99999999',
    };
  }

  override async createAccountLink(
    _options: CreateAccountLinkOptions
  ): Promise<AccountLinkResult> {
    return {
      url: 'https://connect.stripe.com/setup/e2e-stub',
      // Well clear of any test's runtime, without reading the clock at import.
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  override async createTerminalConnectionToken(
    _connectedAccountId: string
  ): Promise<ConnectionTokenResult> {
    return { secret: `${this.stubId('pst')}_secret_e2e` };
  }

  override async getCheckoutSession(
    _connectedAccountId: string,
    _sessionId: string
  ): Promise<Stripe.Checkout.Session> {
    // Deliberately NOT a plausible-looking session. This method has no callers
    // today, so any value here would be fiction that nothing validates — and a
    // fake `status: 'complete', payment_status: 'paid'` is the worst kind,
    // because a future settlement path would read it as a real payment and pass
    // by accident. Fail loudly instead; whoever wires this up writes the stub
    // that matches what they actually assert.
    throw new Error(
      'StripeConnectStubService.getCheckoutSession is not stubbed — it has no ' +
        'callers. Add a stub returning what your test asserts, rather than ' +
        'relying on a fabricated session.'
    );
  }

  override async expireCheckoutSession(
    _connectedAccountId: string,
    _sessionId: string
  ): Promise<void> {
    // Nothing to expire against a stub.
  }

  override async cancelConnectedSubscription(
    _connectedAccountId: string,
    _subscriptionId: string
  ): Promise<{ status: Stripe.Subscription.Status }> {
    return { status: 'canceled' };
  }

  override async createTerminalPaymentIntent(
    _options: CreateTerminalPaymentIntentOptions
  ): Promise<TerminalPaymentIntentResult> {
    const id = this.stubId('pi');
    return {
      id,
      clientSecret: `${id}_secret_e2e`,
      status: 'requires_payment_method',
    };
  }

  override async createCardPaymentIntent(
    _options: CreateTerminalPaymentIntentOptions
  ): Promise<TerminalPaymentIntentResult> {
    const id = this.stubId('pi');
    return {
      id,
      clientSecret: `${id}_secret_e2e`,
      status: 'requires_payment_method',
    };
  }

  override async retrievePaymentIntentStatus(
    _connectedAccountId: string,
    paymentIntentId: string
  ): Promise<{ id: string; status: string }> {
    // Stub PaymentIntents settle instantly so `settleCardPayment` trusts the
    // `succeeded` status and closes the sale without waiting on a webhook.
    return { id: paymentIntentId, status: 'succeeded' };
  }

  override async captureTerminalPaymentIntent(
    _connectedAccountId: string,
    paymentIntentId: string
  ): Promise<TerminalPaymentIntentResult> {
    return {
      id: paymentIntentId,
      clientSecret: `${paymentIntentId}_secret_e2e`,
      status: 'succeeded',
    };
  }

  override async cancelPaymentIntent(
    _connectedAccountId: string,
    paymentIntentId: string
  ): Promise<{ id: string; status: string }> {
    return { id: paymentIntentId, status: 'canceled' };
  }

  override async deactivatePaymentLink(
    _connectedAccountId: string,
    _paymentLinkId: string
  ): Promise<void> {
    // No real Payment Link exists in the stub — abandoning a QR tender is a
    // no-op so the E2E suite never touches the network.
  }

  override async expireOpenPaymentLinkSessions(
    _connectedAccountId: string,
    _paymentLinkId: string
  ): Promise<void> {
    // No real checkout sessions exist in the stub — no-op.
  }

  override async createPaymentLink(
    _options: CreatePaymentLinkOptions
  ): Promise<PaymentLinkResult> {
    const paymentLinkId = this.stubId('plink');
    return {
      paymentLinkId,
      paymentLinkUrl: `https://stub.e2e.local/pay/${paymentLinkId}`,
      productId: this.stubId('prod'),
    };
  }

  override async createDepositCheckout(
    _options: CreateDepositCheckoutOptions
  ): Promise<DepositCheckoutResult> {
    const sessionId = this.stubId('cs');
    return { sessionId, url: `https://stub.e2e.local/checkout/${sessionId}` };
  }

  override async createPaymentCheckout(
    _options: CreatePaymentCheckoutOptions
  ): Promise<PaymentCheckoutResult> {
    const sessionId = this.stubId('cs');
    return { sessionId, url: `https://stub.e2e.local/checkout/${sessionId}` };
  }

  override async createShopCheckout(
    _options: CreateShopCheckoutOptions
  ): Promise<PaymentCheckoutResult> {
    const sessionId = this.stubId('cs');
    return { sessionId, url: `https://stub.e2e.local/checkout/${sessionId}` };
  }

  override async createRefund(
    options: CreateRefundOptions
  ): Promise<RefundResult> {
    return {
      id: this.stubId('re'),
      amount: options.amountCents ?? 0,
      currency: 'eur',
      status: 'succeeded',
    };
  }

  override async createRecurringPrice(
    _options: CreateRecurringPriceOptions
  ): Promise<RecurringPriceResult> {
    return { productId: this.stubId('prod'), priceId: this.stubId('price') };
  }

  override async createConnectedCustomer(
    _options: CreateConnectedCustomerOptions
  ): Promise<{ customerId: string }> {
    return { customerId: this.stubId('cus') };
  }

  override async createConnectedSubscription(
    options: CreateConnectedSubscriptionOptions
  ): Promise<ConnectedSubscriptionResult> {
    return {
      subscriptionId: this.stubId('sub'),
      status: 'active' as Stripe.Subscription.Status,
      currentPeriodEnd: options.trialEnd ?? null,
    };
  }
}

// Singleton instance (lazy initialization)
let stripeConnectService: StripeConnectService | null = null;

export function getStripeConnectService(): StripeConnectService {
  if (!stripeConnectService) {
    // `STRIPE_E2E_STUB=true` (preview / local E2E only) swaps in the stub so the
    // browser suite can exercise card/QR/deposit/subscription tenders without
    // real Stripe. Read straight off process.env to keep this package decoupled
    // from the API env schema; `=== 'true'` avoids the `z.coerce.boolean`
    // "false" → true footgun.
    stripeConnectService =
      process.env.STRIPE_E2E_STUB === 'true'
        ? new StripeConnectStubService()
        : new StripeConnectService();
  }
  return stripeConnectService;
}
