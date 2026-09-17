import { db } from '@borradh-workspace/database';
import { handleUnsubscribe } from '@borradh-workspace/features/campaigns';
import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

const UNSUBSCRIBED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head><body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:64px auto;padding:0 20px;text-align:center;color:#1a1f29"><h1 style="font-size:1.4rem">You've been unsubscribed</h1><p style="color:#5b6473">You won't receive any more messages from this campaign. You can close this window.</p></body></html>`;

/**
 * Public campaign surface (no auth). Currently the RFC 8058 one-click
 * unsubscribe + the human-clickable footer link. Open/click tracking is handled
 * by Resend's native events (see ResendWebhooksController).
 */
@SkipThrottle()
@Controller('c')
export class CampaignPublicController {
  private readonly logger = new Logger(CampaignPublicController.name);

  /** RFC 8058 one-click POST target (List-Unsubscribe-Post). */
  @Post('u/:token')
  @HttpCode(HttpStatus.OK)
  async unsubscribeOneClick(
    @Param('token') token: string
  ): Promise<{ ok: boolean }> {
    await handleUnsubscribe(db, { token });
    return { ok: true };
  }

  /** Human-clickable unsubscribe link (email footer). */
  @Get('u/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribePage(@Param('token') token: string): Promise<string> {
    const result = await handleUnsubscribe(db, { token });
    if (result.success) {
      this.logger.log(`Unsubscribe: ${result.data.action}`);
    }
    return UNSUBSCRIBED_PAGE;
  }
}
