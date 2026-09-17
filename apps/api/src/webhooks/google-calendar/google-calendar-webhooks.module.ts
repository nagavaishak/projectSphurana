import { Module } from '@nestjs/common';
import { GoogleCalendarWebhooksController } from './google-calendar-webhooks.controller.js';

@Module({
  controllers: [GoogleCalendarWebhooksController],
})
export class GoogleCalendarWebhooksModule {}
