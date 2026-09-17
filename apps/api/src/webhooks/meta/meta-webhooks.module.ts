import { Module } from '@nestjs/common';
import { MetaWebhooksController } from './meta-webhooks.controller.js';

@Module({
  controllers: [MetaWebhooksController],
  providers: [],
  exports: [],
})
export class MetaWebhooksModule {}
