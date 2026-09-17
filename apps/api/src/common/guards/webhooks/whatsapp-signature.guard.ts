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
 * Verifies the WhatsApp Cloud API `X-Hub-Signature-256` over the RAW body.
 *
 * Deliberately NARROWER than {@link MetaSignatureGuard}: WhatsApp accepts
 * META_APP_SECRET *only*. It never honours META_INSTAGRAM_APP_SECRET, and a
 * shared guard must not widen the accepted key set here.
 *
 * ORDER IS LOAD-BEARING and matches the controller this was lifted from:
 *   1. empty body             -> 400 (before any signature work)
 *   2. META_APP_SECRET unset  -> 500 (fail closed in EVERY environment)
 *   3. digest mismatch        -> 403
 *
 * KNOWN ROUGH EDGE, PRESERVED ON PURPOSE: there is no presence check on the
 * signature header. A missing header reaches `safeCompare(undefined, …)`, where
 * `Buffer.from(undefined)` throws and Nest maps it to 500. The request is still
 * refused — fail-closed — but by crashing rather than by a deliberate 403, unlike
 * every sibling guard. Normalising it to 403 is an improvement someone should
 * choose explicitly; it is not part of a behaviour-preserving extraction.
 */
@Injectable()
export class WhatsAppSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WhatsAppSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const rawHeader = req.headers['x-hub-signature-256'];
    // Cast, not a presence check: see the class comment — the missing-header
    // crash-refusal (500) is pinned behaviour.
    const signature = (
      Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
    ) as string;

    const rawBody = req.rawBody?.toString() ?? '';

    if (!rawBody) {
      this.logger.warn('Empty WhatsApp webhook payload received');
      throw new HttpException('Empty payload', HttpStatus.BAD_REQUEST);
    }

    const appSecret = apiEnv.META_APP_SECRET;
    if (!appSecret) {
      logError(
        'whatsapp.webhookConfig',
        new Error('META_APP_SECRET not configured'),
        { feature: 'webhooks' }
      );
      throw new HttpException(
        'Webhook not configured',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const expectedSignature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

    if (!safeCompare(signature, expectedSignature)) {
      this.logger.warn('Invalid WhatsApp webhook signature');
      throw new HttpException('Invalid signature', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
