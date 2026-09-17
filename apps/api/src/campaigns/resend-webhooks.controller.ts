import { db } from '@borradh-workspace/database';
import { handleResendWebhook } from '@borradh-workspace/features/campaigns';
import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SvixSignatureGuard } from '../common/guards/webhooks/svix-signature.guard.js';

interface ResendWebhookBody {
  type?: string;
  data?: { email_id?: string; to?: string | string[] };
}

/**
 * Resend email-event webhook (bounce/complaint/delivered/opened/clicked).
 * Public, no auth (like the other webhooks). Maps to a campaign recipient via
 * the message id and updates suppression + delivery state.
 *
 * Security: `SvixSignatureGuard` verifies the Svix headers (svix-id /
 * svix-timestamp / svix-signature) against the RAW request body before this
 * handler runs — see that guard for the fail-open/fail-closed config rules.
 */
@SkipThrottle()
@Controller('webhooks/resend')
export class ResendWebhooksController {
  private readonly logger = new Logger(ResendWebhooksController.name);

  @UseGuards(SvixSignatureGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Req() req: RawBodyRequest<Request>): Promise<{ ok: boolean }> {
    const rawBody = req.rawBody?.toString() ?? '';

    let body: ResendWebhookBody;
    try {
      body = rawBody ? (JSON.parse(rawBody) as ResendWebhookBody) : {};
    } catch {
      throw new HttpException('Invalid JSON body', HttpStatus.BAD_REQUEST);
    }

    const to = Array.isArray(body.data?.to) ? body.data?.to[0] : body.data?.to;
    const result = await handleResendWebhook(db, {
      type: body.type ?? '',
      emailId: body.data?.email_id,
      to,
    });
    if (result.success) {
      this.logger.log(`Resend event handled: ${result.data.action}`);
    } else {
      this.logger.warn(`Resend webhook failed: ${result.error.message}`);
    }
    return { ok: true };
  }
}
