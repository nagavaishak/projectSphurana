import { Module } from '@nestjs/common';
import { CampaignPublicController } from './campaign-public.controller';
import { CampaignsController } from './campaigns.controller';
import { ResendWebhooksController } from './resend-webhooks.controller';
import { TwilioWebhooksController } from './twilio-webhooks.controller';

@Module({
  controllers: [
    CampaignsController,
    TwilioWebhooksController,
    ResendWebhooksController,
    CampaignPublicController,
  ],
})
export class CampaignsModule {}
