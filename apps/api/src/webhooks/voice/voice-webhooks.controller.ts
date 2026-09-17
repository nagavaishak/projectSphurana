import {
  Controller,
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
  TelnyxPayloadGuard,
  TelnyxSignatureGuard,
} from '../../common/guards/webhooks/telnyx-signature.guard.js';
import {
  dispatchTelnyxToolCall,
  dispatchTelnyxWebhook,
} from './telnyx-webhook-dispatch.js';

@SkipThrottle()
@Controller('webhooks/voice')
export class VoiceWebhooksController {
  private readonly logger = new Logger(VoiceWebhooksController.name);

  /**
   * Telnyx AI webhook endpoint.
   *
   * Receives conversation.ended and call.initiation.failed events.
   * `TelnyxPayloadGuard` rejects an empty body (400) and an unset
   * TELNYX_WEBHOOK_PUBLIC_KEY (500); the Ed25519 check itself happens inside
   * `handleVoiceWebhook`, which verifies and parses the raw payload together.
   *
   * @see https://developers.telnyx.com/docs/webhooks
   */
  @UseGuards(TelnyxPayloadGuard)
  @Post('telnyx')
  async handleTelnyxWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('telnyx-signature-ed25519') signature: string,
    @Headers('telnyx-timestamp') timestamp: string
  ) {
    this.logger.log('Received Telnyx AI webhook');
    return dispatchTelnyxWebhook({
      rawBody: req.rawBody?.toString() ?? '',
      signature: signature ?? '',
      timestamp: timestamp ?? '',
      logger: this.logger,
    });
  }

  /**
   * Telnyx AI tool webhook endpoint.
   *
   * Called during a live call when the AI assistant needs to execute a tool
   * (e.g., check calendar availability, book appointment). Guard order is
   * load-bearing: payload/config preconditions before signature verification.
   */
  @UseGuards(TelnyxPayloadGuard, TelnyxSignatureGuard)
  @Post('telnyx/tools')
  async handleTelnyxToolWebhook(@Req() req: RawBodyRequest<Request>) {
    this.logger.log('Received Telnyx tool webhook');
    return dispatchTelnyxToolCall({
      rawBody: req.rawBody?.toString() ?? '',
      logger: this.logger,
    });
  }
}
