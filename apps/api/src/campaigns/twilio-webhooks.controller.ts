import { db } from '@borradh-workspace/database';
import { handleSmsStatusWebhook } from '@borradh-workspace/features/campaigns';
import { handleInboundSms } from '@borradh-workspace/features/conversations';
import {
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { TwilioSignatureGuard } from '../common/guards/webhooks/twilio-signature.guard.js';

/**
 * Twilio inbound-SMS webhook. Public (no auth) — Twilio posts here when a lead
 * texts the org's campaign number. STOP/UNSUBSCRIBE → suppression + consent
 * flip via the feature service.
 *
 * Security: `TwilioSignatureGuard` verifies the `X-Twilio-Signature` header
 * against the request URL + POST params (using TWILIO_AUTH_TOKEN) before this
 * handler runs — see that guard for the fail-open/fail-closed config rules.
 */
@SkipThrottle()
@Controller('webhooks/twilio')
export class TwilioWebhooksController {
  private readonly logger = new Logger(TwilioWebhooksController.name);

  @UseGuards(TwilioSignatureGuard)
  @Post('sms')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async inboundSms(@Req() req: Request): Promise<string> {
    // Twilio POSTs application/x-www-form-urlencoded; body-parser has already
    // parsed every field into req.body.
    const params = (req.body ?? {}) as Record<string, string | undefined>;

    const result = await handleInboundSms(db, {
      from: params.From ?? '',
      to: params.To ?? '',
      body: params.Body ?? '',
      messageId: params.MessageSid,
    });

    if (result.success) {
      this.logger.log(
        `Inbound SMS handled: consent=${result.data.consentAction} routed=${result.data.routedToClaire}`
      );
    } else {
      this.logger.warn(`Inbound SMS webhook failed: ${result.error.message}`);
    }

    // Empty TwiML — Twilio's built-in STOP handling sends the carrier-level
    // opt-out confirmation, and Claire replies asynchronously via the worker
    // rather than in this response.
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  /**
   * Twilio message-status callback. Set as `StatusCallback` on every campaign
   * send, so a message's terminal state (delivered / undelivered / failed) makes
   * it back onto the recipient row. Without this every SMS is stuck at `sent`
   * and carrier rejections are invisible in campaign analytics.
   *
   * Same signature verification as the inbound endpoint.
   */
  @UseGuards(TwilioSignatureGuard)
  @Post('status')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async smsStatus(@Req() req: Request): Promise<string> {
    const params = (req.body ?? {}) as Record<string, string | undefined>;

    const result = await handleSmsStatusWebhook(db, {
      messageSid: params.MessageSid ?? params.SmsSid,
      messageStatus: params.MessageStatus ?? params.SmsStatus ?? '',
      errorCode: params.ErrorCode,
      to: params.To,
    });
    if (result.success) {
      this.logger.log(`SMS status handled: ${result.data.action}`);
    } else {
      this.logger.warn(`SMS status webhook failed: ${result.error.message}`);
    }
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }
}
