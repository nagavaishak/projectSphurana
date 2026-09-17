import { db } from '@borradh-workspace/database';
import {
  BillingErrorCodes,
  cancelSubscription,
  createCreditsCheckout,
  createPortalSession,
  createSubscriptionCheckout,
  getCreditBalance,
  getSubscription,
  resolveBillingCurrency,
  seedSubscription,
} from '@borradh-workspace/features/billing';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { getStripeService } from '@borradh-workspace/integrations/stripe';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  Public,
  SkipPaidPlanCheck,
} from '../common/index.js';
import {
  CreateCreditsCheckoutDto,
  CreatePortalSessionDto,
  CreateSubscriptionCheckoutDto,
  SeedSubscriptionDto,
} from './dto/index.js';
import {
  dispatchStripeBillingWebhook,
  runStripeBillingWebhook,
} from './stripe-billing-webhook-dispatch.js';

@Controller('billing')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  private requireActiveOrganization(
    organizationId: string | undefined
  ): string {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    return organizationId;
  }

  // ─────────────────────────────────────────────────────────────────
  // SUBSCRIPTION ENDPOINTS
  // ─────────────────────────────────────────────────────────────────

  @Get('subscription')
  async getSubscription(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Get subscription for organization: ${organizationId}`);

    const result = await getSubscription(db, { organizationId });

    if (!result.success) {
      if (result.error.code === ErrorCodes.NOT_FOUND) {
        return { subscription: null };
      }
      throw this.mapErrorToHttpException(result.error);
    }

    return { subscription: result.data };
  }

  @Get('currency')
  async getBillingCurrency(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await resolveBillingCurrency(db, { organizationId });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post('subscription/checkout')
  async createSubscriptionCheckout(
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('email') customerEmail: string,
    @Body() dto: CreateSubscriptionCheckoutDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createSubscriptionCheckout(db, {
      organizationId,
      customerEmail,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      trialDays: dto.trialDays,
      currency: dto.currency,
    });
    if (!result.success) {
      this.logger.warn(
        `Create subscription checkout failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }
    return result.data;
  }

  /**
   * Attach a subscription that already exists in Stripe to this organization.
   *
   * The sales-led path: the customer bought on the call, so there is no
   * checkout to run and the workspace would otherwise read as unsubscribed —
   * no plan, no credit balance — until someone put them through a payment they
   * had already made. An onboarding specialist (or the owner) pastes the
   * `sub_…`/`cus_…` here; the admin terminal has the same action for staff
   * working outside the customer's account.
   *
   * Open to any member of the org, like the rest of this controller. Adding a
   * role gate here would mean opting the WHOLE controller into RoleGuard and
   * declaring a role for its other ten handlers — a billing-wide authorization
   * decision that deserves its own change, not a side effect of this one.
   *
   * What actually protects it: the id must name a live subscription in OUR
   * Stripe account, and one already attached to another workspace is refused.
   * A member cannot invent an id, and pasting a real one they paid for is the
   * intended use.
   */
  @Post('subscription/seed')
  async seedSubscriptionForOrg(
    @ActiveOrganization() orgId: string | undefined,
    @Body() dto: SeedSubscriptionDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await seedSubscription(db, {
      organizationId,
      stripeRef: dto.stripeRef,
    });
    if (!result.success) {
      this.logger.warn(
        `Seed subscription failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }
    this.logger.log(
      `Subscription ${result.data.stripeSubscriptionId} seeded onto organization ${organizationId}`
    );
    return result.data;
  }

  @Post('subscription/cancel')
  async cancelSubscription(
    @ActiveOrganization() orgId: string | undefined,
    @Body() dto: { immediate?: boolean } = {}
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Cancel subscription for organization: ${organizationId}`);

    const result = await cancelSubscription(db, {
      organizationId,
      immediate: dto.immediate ?? false,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  // ─────────────────────────────────────────────────────────────────
  // CREDIT ENDPOINTS
  // ─────────────────────────────────────────────────────────────────

  @Get('credits')
  async getCreditBalance(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Get credit balance for organization: ${organizationId}`);

    const result = await getCreditBalance(db, { organizationId });

    if (!result.success) {
      if (result.error.code === ErrorCodes.NOT_FOUND) {
        return { balance: null };
      }
      throw this.mapErrorToHttpException(result.error);
    }

    // Return balance with human-readable values
    return {
      balance: {
        ...result.data,
        creditsAvailable: result.data.balance / 100, // Convert from precision
        includedMonthly: result.data.includedCredits / 100,
      },
    };
  }

  @Post('credits/checkout')
  async createCreditsCheckout(
    @ActiveOrganization() orgId: string | undefined,
    @Body() dto: CreateCreditsCheckoutDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Create credits checkout for organization: ${organizationId}`
    );

    const result = await createCreditsCheckout(db, {
      organizationId,
      creditPackageId: dto.creditPackageId,
      quantity: dto.quantity,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });

    if (!result.success) {
      this.logger.warn(`Create credits checkout failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get('credits/packages')
  async getCreditPackages() {
    const stripe = getStripeService();
    const packages = stripe.getCreditPackages();

    return {
      packages: packages.map((pkg) => ({
        ...pkg,
        credits: pkg.credits / 100, // Convert from precision
        priceFormatted: `$${(pkg.priceInCents / 100).toFixed(2)}`,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // PORTAL ENDPOINT
  // ─────────────────────────────────────────────────────────────────

  @Post('portal')
  async createPortalSession(
    @ActiveOrganization() orgId: string | undefined,
    @Body() dto: CreatePortalSessionDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Create portal session for organization: ${organizationId}`
    );

    const result = await createPortalSession(db, {
      organizationId,
      returnUrl: dto.returnUrl,
    });

    if (!result.success) {
      this.logger.warn(`Create portal session failed: ${result.error.code}`);
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  // ─────────────────────────────────────────────────────────────────
  // PLAN INFO
  // ─────────────────────────────────────────────────────────────────

  @Get('plan')
  async getPlanInfo() {
    const stripe = getStripeService();
    const plan = stripe.getPlan();

    return {
      plan: {
        ...plan,
        includedCredits: plan.includedCredits / 100,
        priceFormatted: `$${(plan.priceInCents / 100).toFixed(2)}/month`,
        currencyPrices: plan.currencyPrices,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // WEBHOOK
  // ─────────────────────────────────────────────────────────────────

  @Public()
  @SkipThrottle()
  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string
  ) {
    this.logger.log('Received Stripe webhook');
    return dispatchStripeBillingWebhook({
      rawBody: req.rawBody,
      signature,
      logger: this.logger,
      execute: runStripeBillingWebhook,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // ERROR MAPPING
  // ─────────────────────────────────────────────────────────────────

  private mapErrorToHttpException(error: { code: string; message: string }) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case ErrorCodes.NOT_FOUND:
      case BillingErrorCodes.SUBSCRIPTION_NOT_FOUND:
      case BillingErrorCodes.CREDIT_BALANCE_NOT_FOUND:
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      case ErrorCodes.CONFLICT:
      case BillingErrorCodes.SUBSCRIPTION_ALREADY_EXISTS:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      // `seedSubscription` answers CONFLICT for "already attached to another
      // workspace" and EXTERNAL_SERVICE_ERROR when Stripe cannot be reached.
      // Both used to fall through to 500, which told the operator the product
      // was broken when the message underneath said exactly what to do.
      case ErrorCodes.EXTERNAL_SERVICE_ERROR:
        return new HttpException(error.message, HttpStatus.BAD_GATEWAY);
      case BillingErrorCodes.SUBSCRIPTION_INACTIVE:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      case BillingErrorCodes.INSUFFICIENT_CREDITS:
        return new HttpException(error.message, HttpStatus.PAYMENT_REQUIRED);
      case BillingErrorCodes.INVALID_CREDIT_PACKAGE:
      case BillingErrorCodes.STRIPE_CHECKOUT_ERROR:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
