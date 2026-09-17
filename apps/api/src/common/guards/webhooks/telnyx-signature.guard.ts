import { voiceEnv } from '@borradh-workspace/env/voice';
import { verifyTelnyxWebhookSignature } from '@borradh-workspace/integrations/voice';
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
 * Payload/configuration preconditions shared by BOTH Telnyx webhook routes.
 *
 * ORDER IS LOAD-BEARING and matches the handlers this was lifted from:
 *   1. empty body                      -> 400
 *   2. TELNYX_WEBHOOK_PUBLIC_KEY unset -> 500 (fail closed, logged)
 *
 * `/webhooks/voice/telnyx` stops here: its Ed25519 check happens INSIDE
 * `handleVoiceWebhook`, which needs the raw payload to verify and parse in one
 * pass. Duplicating it in a guard would double-verify and change which error
 * body a bad signature produces.
 */
@Injectable()
export class TelnyxPayloadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const rawBody = req.rawBody?.toString() ?? '';

    if (!rawBody) {
      throw new HttpException('Empty payload', HttpStatus.BAD_REQUEST);
    }

    if (!voiceEnv.TELNYX_WEBHOOK_PUBLIC_KEY) {
      logError(
        'voice.webhookConfig',
        new Error('TELNYX_WEBHOOK_PUBLIC_KEY not configured'),
        { feature: 'webhooks' }
      );
      throw new HttpException(
        'Webhook not configured',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return true;
  }
}

/**
 * Ed25519 verification for `/webhooks/voice/telnyx/tools`, which is called
 * mid-call and has no downstream verification of its own.
 *
 * MUST be listed AFTER `TelnyxPayloadGuard` in `@UseGuards(...)` — the empty
 * body (400) and unset-key (500) answers are checked before any signature work,
 * exactly as the handler did.
 *
 *   3. missing signature/timestamp header -> 401
 *   4. digest mismatch                    -> 401
 */
@Injectable()
export class TelnyxSignatureGuard implements CanActivate {
  private readonly logger = new Logger(TelnyxSignatureGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const rawBody = req.rawBody?.toString() ?? '';
    const signature = header(req, 'telnyx-signature-ed25519');
    const timestamp = header(req, 'telnyx-timestamp');

    if (!signature || !timestamp) {
      this.logger.warn('Missing webhook signature headers for tool call');
      throw new HttpException('Missing signature', HttpStatus.UNAUTHORIZED);
    }

    const isValid = await verifyTelnyxWebhookSignature(
      rawBody,
      signature,
      timestamp,
      // TelnyxPayloadGuard has already rejected an unset key with 500.
      voiceEnv.TELNYX_WEBHOOK_PUBLIC_KEY as string
    );

    if (!isValid) {
      this.logger.warn('Invalid webhook signature for tool call');
      throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
    }

    return true;
  }
}
