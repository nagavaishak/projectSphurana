import { verifyOAuthState } from '@borradh-workspace/features/shared/oauth';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  OAUTH_PROVIDER_KEY,
  type OAuthCallbackMeta,
  OAuthStateError,
  type OAuthStateRequest,
} from './oauth-callback.js';

/**
 * Verifies the HMAC-signed `state` on a provider OAuth callback and attaches the
 * decoded payload to the request for `@OAuthState()`.
 *
 * This replaces per-handler `JSON.parse(Buffer.from(state,'base64'))`, which
 * trusted an attacker-suppliable blob to name the organization being connected.
 * See `packages/features/src/shared/oauth-state.ts` for the vulnerability and
 * the scheme.
 *
 * FAIL-CLOSED. Anything that does not verify — missing, unsigned, forged,
 * expired, or minted for a different provider — throws `OAuthStateError`, which
 * `OAuthCallbackExceptionFilter` renders as the same friendly
 * "Connection expired. Please try again." redirect a malformed state already
 * produced. The user-visible behaviour for a genuinely broken flow is unchanged;
 * what changed is that a FORGED flow now lands there too.
 *
 * A route with no @OAuthCallback provider is a configuration error, not a
 * pass-through: it rejects, because silently allowing would reintroduce exactly
 * the hole this closes.
 */
@Injectable()
export class OAuthStateGuard implements CanActivate {
  private readonly logger = new Logger(OAuthStateGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<
      OAuthCallbackMeta | undefined
    >(OAUTH_PROVIDER_KEY, [context.getHandler(), context.getClass()]);
    if (!meta) {
      this.logger.error(
        'OAuthStateGuard on a route with no @OAuthCallback(provider) — rejecting'
      );
      throw new OAuthStateError('unknown');
    }
    const { provider, label } = meta;

    const req = context.switchToHttp().getRequest<OAuthStateRequest>();
    const raw = req.query?.state;
    const state = Array.isArray(raw) ? raw[0] : raw;

    const payload = verifyOAuthState(
      typeof state === 'string' ? state : undefined,
      provider
    );
    if (!payload) {
      this.logger.warn(
        `${provider} OAuth callback rejected: state missing, unsigned, forged or expired`
      );
      throw new OAuthStateError(provider, label);
    }

    req.oauthState = payload;
    return true;
  }
}
