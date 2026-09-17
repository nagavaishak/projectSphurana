import { Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { dispatchStripeConnectWebhook } from './stripe-connect-dispatch.js';

@SkipThrottle()
@Controller('webhooks/stripe-connect')
export class StripeConnectWebhooksController {
  private readonly logger = new Logger(StripeConnectWebhooksController.name);

  /**
   * Stripe Connect webhook endpoint. Verification, registry routing and the
   * idempotency ledger all live in `dispatchStripeConnectWebhook`.
   *
   * @see https://stripe.com/docs/connect/webhooks
   */
  @Post()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string
  ) {
    this.logger.log('Received Stripe Connect webhook');
    return dispatchStripeConnectWebhook({
      rawBody: req.rawBody,
      signature,
      logger: this.logger,
    });
  }
}
