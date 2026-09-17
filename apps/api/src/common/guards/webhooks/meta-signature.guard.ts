import { createHmac, timingSafeEqual } from 'node:crypto';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError } from '@borradh-workspace/observability';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Verifies Meta's `X-Hub-Signature-256` (`sha256=` + hex HMAC-SHA256 over the
 * RAW body) before any handler runs, for the leadgen and messaging webhooks.
 *
 * The digest is computed over `request.rawBody` — Meta signs bytes, not the
 * parsed object. Instagram traffic may be signed with a SEPARATE app secret, so
 * both META_APP_SECRET and (when configured) META_INSTAGRAM_APP_SECRET are
 * tried.
 *
 * ORDER IS LOAD-BEARING and matches the controllers this was lifted from:
 *   1. empty body                -> 400 (before any signature work)
 *   2. META_APP_SECRET unset     -> 500 (fail closed in EVERY environment)
 *   3. missing signature header  -> 403
 *   4. digest mismatch           -> 403
 */
@Injectable()
export class MetaSignatureGuard implements CanActivate {
  private readonly logger = new Logger(MetaSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const rawHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    // Get raw body as string for signature verification
    const rawBody = req.rawBody?.toString() ?? '';

    if (!rawBody) {
      this.logger.warn('Empty webhook payload received');
      throw new HttpException('Empty payload', HttpStatus.BAD_REQUEST);
    }

    // Get app secret from validated environment
    const appSecret = apiEnv.META_APP_SECRET;
    if (!appSecret) {
      logError(
        'meta.webhookConfig',
        new Error('META_APP_SECRET not configured'),
        { feature: 'webhooks' }
      );
      throw new HttpException(
        'Webhook not configured',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    // Verify the X-Hub-Signature-256 BEFORE parsing or logging the payload.
    // Instagram webhooks may be signed with a separate Instagram App Secret.
    if (!signature) {
      this.logger.warn('Missing x-hub-signature-256 header');
      throw new HttpException('Missing signature', HttpStatus.FORBIDDEN);
    }

    const instagramAppSecret = apiEnv.META_INSTAGRAM_APP_SECRET;
    const secrets = instagramAppSecret
      ? [appSecret, instagramAppSecret]
      : [appSecret];

    const signatureValid = secrets.some((secret) => {
      const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
      return safeCompare(signature, expected);
    });

    if (!signatureValid) {
      this.logger.warn('Invalid Meta webhook signature');
      throw new HttpException('Invalid signature', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
