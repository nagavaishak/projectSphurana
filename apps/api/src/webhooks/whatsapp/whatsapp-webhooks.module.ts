import { Module } from '@nestjs/common';
import { WhatsAppWebhooksController } from './whatsapp-webhooks.controller.js';

@Module({
  controllers: [WhatsAppWebhooksController],
  providers: [],
  exports: [],
})
export class WhatsAppWebhooksModule {}
