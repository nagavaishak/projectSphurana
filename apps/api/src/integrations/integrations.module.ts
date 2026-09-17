import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsStripeController } from './stripe/stripe.controller.js';

@Module({
  controllers: [IntegrationsController, IntegrationsStripeController],
  providers: [],
  exports: [],
})
export class IntegrationsModule {}
