import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';

@Module({
  controllers: [BillingController],
  providers: [],
  exports: [],
})
export class BillingModule {}
