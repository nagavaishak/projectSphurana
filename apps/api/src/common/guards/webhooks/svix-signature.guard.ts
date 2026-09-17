import { apiEnv } from '@borradh-workspace/env/api';
import { verifySvixSignature } from '@borradh-workspace/integrations';
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

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Verifies Svix webhook signatures (Resend) before any handler runs.
 *
 * Svix signs the RAW request bytes — `${svix-id}.${svix-timestamp}.${rawBody}`
 * — so this guard reads `request.rawBody` (the app boots with `rawBody: true`).
 * Reading the parsed body and re-serializing would compute a different digest
 * for byte-identical-after-parse payloads, which is either a total outage or a
 * silent auth bypass depending on the fallback.
 *
 * Config behaviour preserved verbatim: unset RESEND_WEBHOOK_SECRET fails OPEN in
 * non-production and CLOSED (500) in production.
 *
 * REPLAY WINDOW: `verifySvixSignature` enforces Svix's documented +/-300s
 * tolerance on `svix-timestamp`. It used to treat that header as signed input
 * only and never compare it to the clock, which made any captured delivery
 * replayable forever; `webhook-signatures.int-spec.ts` pinned a year-stale
 * timestamp returning 200 as a characterised GAP. That gap is now closed and
 * the pin inverted. Note the window narrows replay, it does not eliminate it:
 * there is still no `svix-id` nonce store, so a replay within five minutes is
 * accepted.
 */
@Injectable()
export class SvixSignatureGuard implements CanActivate {
  private readonly logger = new Logger(SvixSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const secret = apiEnv.RESEND_WEBHOOK_SECRET;

    if (!secret) {
      if (apiEnv.NODE_ENV === 'production') {
        logError(
          'resend.webhookConfig',
          new Error(
            'RESEND_WEBHOOK_SECRET not configured — rejecting Resend webhook'
          ),
          { feature: 'campaigns' }
        );
        throw new HttpException(
          'Webhook not configured',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
      this.logger.warn(
        'RESEND_WEBHOOK_SECRET not set — skipping signature verification (non-production)'
      );
      return true;
    }

    // Svix signs the raw body byte-for-byte — never re-serialize before verify.
    const rawBody = req.rawBody?.toString() ?? '';

    const valid = verifySvixSignature({
      secret,
      id: header(req, 'svix-id'),
      timestamp: header(req, 'svix-timestamp'),
      signature: header(req, 'svix-signature'),
      payload: rawBody,
    });
    if (!valid) {
      this.logger.warn('Rejected Resend webhook with invalid signature');
      throw new HttpException('Invalid signature', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
