import { apiEnv } from '@borradh-workspace/env/api';
import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  HubChallenge,
  HubChallengeEcho,
  META_HUB_CHALLENGE,
} from '../../common/guards/webhooks/hub-challenge.guard.js';
import { MetaSignatureGuard } from '../../common/guards/webhooks/meta-signature.guard.js';
import {
  dispatchMetaDataDeletion,
  dispatchMetaLeadgenWebhook,
  dispatchMetaMessagingWebhook,
} from './meta-webhook-dispatch.js';

@SkipThrottle()
@Controller('webhooks/meta')
export class MetaWebhooksController {
  private readonly logger = new Logger(MetaWebhooksController.name);

  /**
   * Meta webhook verification endpoint.
   *
   * `HubChallenge` verifies `hub.mode`/`hub.verify_token` (500 when the token
   * is unconfigured, 403 on mismatch); the only thing left is echoing the
   * nonce.
   *
   * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started
   */
  @HubChallenge(META_HUB_CHALLENGE)
  @Get('leadgen')
  verifyWebhook(@HubChallengeEcho() challenge: string): string {
    return challenge;
  }

  /**
   * Meta leadgen webhook endpoint.
   *
   * `MetaSignatureGuard` has already rejected an empty body (400), an unset
   * META_APP_SECRET (500) and any bad/absent signature (403), so both the raw
   * body and the app secret are known-good here.
   *
   * @see https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
   */
  @UseGuards(MetaSignatureGuard)
  @Post('leadgen')
  async handleLeadgenWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string
  ) {
    this.logger.log('Received Meta webhook on leadgen endpoint');
    return dispatchMetaLeadgenWebhook({
      rawBody: req.rawBody?.toString() ?? '',
      signature: signature ?? '',
      appSecret: apiEnv.META_APP_SECRET ?? '',
      logger: this.logger,
    });
  }

  /**
   * Meta messaging webhook verification endpoint — same handshake as leadgen.
   *
   * @see https://developers.facebook.com/docs/messenger-platform/webhooks
   */
  @HubChallenge(META_HUB_CHALLENGE)
  @Get('messaging')
  verifyMessagingWebhook(@HubChallengeEcho() challenge: string): string {
    return challenge;
  }

  /**
   * Meta messaging webhook endpoint.
   *
   * `MetaSignatureGuard` has already verified the raw body against
   * META_APP_SECRET (and META_INSTAGRAM_APP_SECRET when configured), and
   * rejected an empty payload with 400.
   *
   * @see https://developers.facebook.com/docs/messenger-platform/webhooks
   */
  @UseGuards(MetaSignatureGuard)
  @Post('messaging')
  async handleMessagingWebhook(@Req() req: RawBodyRequest<Request>) {
    this.logger.log('Received Meta messaging webhook');
    return dispatchMetaMessagingWebhook({
      rawBody: req.rawBody?.toString() ?? '',
      logger: this.logger,
    });
  }

  /**
   * Meta data deletion callback endpoint.
   *
   * No auth guard — Meta calls this directly with a self-signed
   * `signed_request` that the use case verifies.
   *
   * @see https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
   */
  @Post('data-deletion')
  async handleDataDeletion(@Body('signed_request') signedRequest: string) {
    this.logger.log('Received Meta data deletion callback');
    return dispatchMetaDataDeletion({ signedRequest, logger: this.logger });
  }
}
