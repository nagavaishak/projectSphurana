import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { GoogleChannelTokenGuard } from '../../common/guards/webhooks/google-channel-token.guard.js';
import { dispatchGoogleCalendarWebhook } from './google-calendar-webhook-dispatch.js';

@Controller('webhooks/google-calendar')
@SkipThrottle()
export class GoogleCalendarWebhooksController {
  private readonly logger = new Logger(GoogleCalendarWebhooksController.name);

  /**
   * Google Calendar push notification endpoint.
   *
   * Google sends POST requests with notification headers (no body).
   * Must return 200 quickly — Google retries on failure with exponential
   * backoff — so the sync itself runs detached inside the dispatch.
   *
   * Security: `GoogleChannelTokenGuard` compares `x-goog-channel-token` against
   * GOOGLE_CALENDAR_WEBHOOK_TOKEN in constant time (fail-closed). It
   * deliberately lets requests WITHOUT the required `x-goog-*` headers through
   * un-checked, so the acknowledgement still returns 200 for them.
   *
   * @see https://developers.google.com/calendar/api/guides/push
   */
  @UseGuards(GoogleChannelTokenGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-goog-channel-id') channelId: string,
    @Headers('x-goog-resource-state') resourceState: string,
    @Headers('x-goog-resource-id') resourceId: string,
    @Headers('x-goog-channel-token') channelToken?: string
  ) {
    return dispatchGoogleCalendarWebhook({
      channelId,
      resourceState,
      resourceId,
      channelToken,
      logger: this.logger,
    });
  }
}
