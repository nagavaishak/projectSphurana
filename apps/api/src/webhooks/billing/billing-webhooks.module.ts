import { Module } from '@nestjs/common';
import { BillingWebhooksController } from './billing-webhooks.controller.js';

@Module({
  controllers: [BillingWebhooksController],
  providers: [],
  exports: [],
})
export class BillingWebhooksModule {}
