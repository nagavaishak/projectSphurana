import { Module } from '@nestjs/common';
import { StripeConnectWebhooksController } from './stripe-connect-webhooks.controller.js';

@Module({
  controllers: [StripeConnectWebhooksController],
  providers: [],
  exports: [],
})
export class StripeConnectWebhooksModule {}
