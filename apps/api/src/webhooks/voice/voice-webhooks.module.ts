import { Module } from '@nestjs/common';
import { VoiceWebhooksController } from './voice-webhooks.controller.js';

@Module({
  controllers: [VoiceWebhooksController],
  providers: [],
  exports: [],
})
export class VoiceWebhooksModule {}
