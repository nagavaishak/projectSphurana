import { Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  dispatchStripeBillingWebhook,
  runStripeBillingWebhookSystemScoped,
} from '../../billing/stripe-billing-webhook-dispatch.js';
import { Public } from '../../common/index.js';

/**
 * Stripe customer-billing webhook — alias path under /webhooks/billing
 * so the borradh-webhooks router can fan it out to per-PR previews. The
 * legacy /billing/webhook route in billing.controller.ts still works for
 * any Stripe endpoint that hasn't been migrated yet; this controller is
 * a parallel route, not a replacement. Both share
 * `dispatchStripeBillingWebhook` — this one on a system-scoped connection.
 *
 * The router strips its own /webhook/ prefix and prepends /webhooks/, so:
 *   https://borradh-webhooks.fly.dev/webhook/billing
 * becomes a fan-out to each subscriber's
 *   /webhooks/billing
 * which is what this handler responds to.
 */
@SkipThrottle()
@Controller('webhooks/billing')
export class BillingWebhooksController {
  private readonly logger = new Logger(BillingWebhooksController.name);

  @Public()
  @Post()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string
  ) {
    this.logger.log('Received Stripe billing webhook (router fan-out path)');
    return dispatchStripeBillingWebhook({
      rawBody: req.rawBody,
      signature,
      logger: this.logger,
      execute: runStripeBillingWebhookSystemScoped,
    });
  }
}
