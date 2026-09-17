import { apiEnv } from '@borradh-workspace/env/api';
import { validateTwilioSignature } from '@borradh-workspace/integrations';
import { logError } from '@borradh-workspace/observability';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Verifies Twilio's `X-Twilio-Signature` before any handler runs.
 *
 * Twilio is the one provider here that does NOT sign raw bytes: the signature is
 * HMAC-SHA1 over the request URL concatenated with every POST form param sorted
 * by key. So this guard reads the PARSED body (`request.body`) deliberately —
 * that is the signed content for this scheme.
 *
 * Config behaviour is preserved verbatim from the controller it was extracted
 * from: with no TWILIO_AUTH_TOKEN, verification fails OPEN in non-production
 * (local dev ergonomics) and fails CLOSED with 500 in production.
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  private readonly logger = new Logger(TwilioSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const signature = req.headers['x-twilio-signature'];
    const signatureStr = Array.isArray(signature) ? signature[0] : signature;
    // Twilio POSTs application/x-www-form-urlencoded; body-parser has already
    // parsed every field into req.body. Signature validation needs the FULL
    // set of params.
    const params = (req.body ?? {}) as Record<string, string | undefined>;

    const authToken = apiEnv.TWILIO_AUTH_TOKEN;

    if (!authToken) {
      if (apiEnv.NODE_ENV === 'production') {
        // Fail closed: never process an unverifiable webhook in prod.
        logError(
          'twilio.webhookConfig',
          new Error('TWILIO_AUTH_TOKEN not configured — rejecting inbound SMS'),
          { feature: 'campaigns' }
        );
        throw new HttpException(
          'Webhook not configured',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
      // Dev/preview: fail open so local testing works without the token.
      this.logger.warn(
        'TWILIO_AUTH_TOKEN not set — skipping signature verification (non-production)'
      );
      return true;
    }

    const url = reconstructUrl(req);
    const valid = validateTwilioSignature({
      authToken,
      signature: signatureStr,
      url,
      params,
    });
    if (!valid) {
      this.logger.warn(
        `Rejected Twilio webhook with invalid signature (url=${url})`
      );
      throw new HttpException('Invalid signature', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}

/**
 * Rebuild the exact public URL Twilio signed. Twilio computes the signature
 * over the URL it POSTs to; behind Fly's proxy the original scheme/host are
 * carried in X-Forwarded-Proto / Host, and the path (incl. query) is
 * preserved as originalUrl.
 */
function reconstructUrl(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
      ?.split(',')[0]
      ?.trim() ||
    req.protocol ||
    'https';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
  const hostStr = Array.isArray(host) ? host[0] : host;
  return `${proto}://${hostStr}${req.originalUrl}`;
}
