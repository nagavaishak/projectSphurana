import { timingSafeEqual } from 'node:crypto';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Verifies the Google Calendar push-notification channel token.
 *
 * NOT a signature scheme: Google Calendar push notifications carry no body and
 * no HMAC. Authenticity rests entirely on the static secret we supplied at
 * watch-registration time and Google echoes back in `x-goog-channel-token`,
 * compared in constant time. There is nothing body-derived here, so the
 * raw-vs-parsed hazard does not apply.
 *
 * SHORT-CIRCUIT PRESERVED: when the required `x-goog-*` notification headers are
 * absent the guard ALLOWS the request through WITHOUT checking the token, so the
 * handler can acknowledge it 200 exactly as before. Rejecting those here would
 * turn acknowledgements into 403s and start Google's retry backoff.
 */
@Injectable()
export class GoogleChannelTokenGuard implements CanActivate {
  private readonly logger = new Logger(GoogleChannelTokenGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const channelId = header(req, 'x-goog-channel-id');
    const resourceState = header(req, 'x-goog-resource-state');
    const resourceId = header(req, 'x-goog-resource-id');
    const channelToken = header(req, 'x-goog-channel-token');

    // Not a Google notification we recognise — let the handler acknowledge it
    // 200 without a token check (pinned behaviour, see the class comment).
    if (!channelId || !resourceState || !resourceId) return true;

    // Verify webhook token before processing (fail-closed)
    const expectedToken = apiEnv.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
    if (!expectedToken) {
      this.logger.error(
        'GOOGLE_CALENDAR_WEBHOOK_TOKEN not configured — rejecting webhook'
      );
      throw new HttpException(
        'Webhook not configured',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    if (!channelToken) {
      this.logger.warn('Missing Google Calendar webhook token');
      throw new HttpException('Invalid webhook token', HttpStatus.FORBIDDEN);
    }
    const aBuf = Buffer.from(channelToken);
    const bBuf = Buffer.from(expectedToken);
    if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
      this.logger.warn('Invalid Google Calendar webhook token');
      throw new HttpException('Invalid webhook token', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
