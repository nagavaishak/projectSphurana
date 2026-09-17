import { timingSafeEqual } from 'node:crypto';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError } from '@borradh-workspace/observability';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type Type,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Meta's `hub.mode` / `hub.verify_token` / `hub.challenge` subscription
 * handshake — ONE implementation for every endpoint that speaks it.
 *
 * This handshake is pure VERIFICATION: it decides whether the caller is Meta,
 * and the only thing the handler ever does on success is echo back the nonce it
 * was handed. Under the controller-thinness rule that makes it a Guard plus a
 * param decorator, not a handler body — which is also how four hand-written
 * copies (webhooks/meta leadgen + messaging, webhooks/whatsapp, meta-ads)
 * collapse into this file.
 *
 * ORDER IS LOAD-BEARING and matches the handlers this was lifted from:
 *   1. verify token unset  -> 500 (fail closed, logged via `logError`)
 *   2. mode !== 'subscribe' -> 403
 *   3. token mismatch       -> 403   (constant-time, length-checked first)
 *
 * NOT collapsed into this: `integrations.controller.ts::facebookWebhookVerify`.
 * It compares with `===` (not constant time) and has NO unset-token check, so
 * when both `META_WEBHOOK_VERIFY_TOKEN` and the query param are absent it
 * currently ECHOES the challenge instead of failing. Routing it through this
 * guard would change that endpoint's observable behaviour, so it was left as
 * found rather than silently "fixed" under a refactor.
 */

const queryParam = (req: Request, name: string): string =>
  (req.query as Record<string, unknown> | undefined)?.[name] as string;

/** Constant-time string comparison to prevent timing attacks. */
const safeCompare = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
};

export interface HubChallengeOptions {
  /** `logError` operation name used when the verify token is not configured. */
  operation: string;
  /** `logError` feature tag. */
  feature: string;
  /** Message thrown (500) when the verify token is not configured. */
  unconfiguredMessage: string;
  /** Message thrown (403) when mode/token do not match. */
  forbiddenMessage: string;
  /** Error message recorded when the verify token is not configured. */
  unconfiguredError: string;
}

/**
 * Builds a DI-free guard class closed over `options`. A mixin rather than a
 * Reflector-driven guard so it instantiates with no providers — the webhook
 * controllers are booted bare in the characterization suites.
 */
export function HubChallengeGuard(
  options: HubChallengeOptions
): Type<CanActivate> {
  @Injectable()
  class MetaHubChallengeGuard implements CanActivate {
    private readonly logger = new Logger('HubChallengeGuard');

    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<Request>();
      const mode = queryParam(req, 'hub.mode');
      const token = queryParam(req, 'hub.verify_token');

      const verifyToken = apiEnv.META_WEBHOOK_VERIFY_TOKEN;
      if (!verifyToken) {
        logError(options.operation, new Error(options.unconfiguredError), {
          feature: options.feature,
        });
        throw new HttpException(
          options.unconfiguredMessage,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (mode !== 'subscribe' || !safeCompare(token, verifyToken)) {
        this.logger.warn('Webhook verification failed - invalid token');
        throw new HttpException(options.forbiddenMessage, HttpStatus.FORBIDDEN);
      }

      return true;
    }
  }

  return MetaHubChallengeGuard;
}

/**
 * Declares an endpoint as a Meta subscription-handshake endpoint. Pair with
 * `@HubChallengeEcho()` so the handler body is a single `return challenge`.
 */
export const HubChallenge = (options: HubChallengeOptions) =>
  applyDecorators(UseGuards(HubChallengeGuard(options)));

/** The `hub.challenge` nonce the guard has already authorised us to echo. */
export const HubChallengeEcho = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    queryParam(ctx.switchToHttp().getRequest<Request>(), 'hub.challenge')
);

/** Options used by every endpoint that verifies against the Meta app's token. */
export const META_HUB_CHALLENGE: HubChallengeOptions = {
  operation: 'meta.webhookVerify',
  feature: 'webhooks',
  unconfiguredError: 'META_WEBHOOK_VERIFY_TOKEN not configured',
  unconfiguredMessage: 'Webhook not configured',
  forbiddenMessage: 'Forbidden',
};
