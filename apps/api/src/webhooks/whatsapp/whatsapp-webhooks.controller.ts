import { Controller, Get, Logger, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  HubChallenge,
  HubChallengeEcho,
  META_HUB_CHALLENGE,
} from '../../common/guards/webhooks/hub-challenge.guard.js';
import { WhatsAppSignatureGuard } from '../../common/guards/webhooks/whatsapp-signature.guard.js';
import { dispatchWhatsappWebhook } from './whatsapp-webhook-dispatch.js';

@SkipThrottle()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhooksController {
  private readonly logger = new Logger(WhatsAppWebhooksController.name);

  /**
   * WhatsApp Cloud API webhook verification endpoint
   *
   * Same hub.challenge pattern as Meta Messenger webhooks.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
   */
  @HubChallenge({ ...META_HUB_CHALLENGE, operation: 'whatsapp.webhookVerify' })
  @Get()
  verifyWebhook(@HubChallengeEcho() challenge: string): string {
    return challenge;
  }

  /**
   * WhatsApp Cloud API webhook endpoint
   *
   * Receives incoming message events from WhatsApp Cloud API.
   * Payload format differs from Messenger/Instagram webhooks.
   *
   * `WhatsAppSignatureGuard` has already rejected an empty body (400), an unset
   * META_APP_SECRET (500) and any bad signature (403), so the raw body is
   * known-good here. Everything after that — envelope walk, registry
   * disposition, Claire vs receptionist routing, statuses, echoes and history —
   * is `dispatchWhatsappWebhook`.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
   */
  @UseGuards(WhatsAppSignatureGuard)
  @Post()
  async handleWebhook(@Req() req: RawBodyRequest<Request>) {
    return dispatchWhatsappWebhook({
      rawBody: req.rawBody?.toString() ?? '',
      logger: this.logger,
    });
  }
}
