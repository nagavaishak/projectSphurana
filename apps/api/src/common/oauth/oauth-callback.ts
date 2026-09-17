import type { OAuthStatePayload } from '@borradh-workspace/features/shared/oauth';
import {
  type CanActivate,
  type ExecutionContext,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Transport machinery for provider OAuth callbacks.
 *
 * These endpoints CANNOT carry `AuthGuard` — the provider redirects a browser to
 * them and there is no guarantee of a session. What authenticates them is the
 * signed `state` they carry, verified here at the entry point (which is where
 * `capability-architecture.md` Correction 4 says policy belongs) rather than
 * inside each handler.
 *
 * Three pieces, one per NestJS cross-cutting mechanism, so a callback handler
 * body can be exactly "call the use case, return it":
 *
 *   @OAuthCallback('stripe')  declares which provider's state is acceptable
 *   OAuthStateGuard           verifies the signature, fail-closed
 *   @OAuthState()             hands the verified payload to the handler
 *
 * and `OAuthRedirectInterceptor` turns the use case's returned outcome into the
 * browser redirect, so handlers need no `@Res()` and never build a URL.
 */

export const OAUTH_PROVIDER_KEY = 'oauth:provider';

export interface OAuthCallbackMeta {
  /** The `provider` field the signed state must carry. */
  provider: string;
  /**
   * The value the web app expects in `?integration=` on the redirect. Usually
   * the same as `provider`, but not always: the Google Calendar state says
   * `google_calendar` while the UI keys off `calendar`. Conflating the two
   * would silently change which toast the frontend shows on failure.
   */
  label: string;
}

/**
 * Names the provider whose signed state this route accepts. Binding the
 * provider matters: without it, a state minted for a flow the caller may
 * legitimately start (Gmail) would verify at a flow they may not (Stripe).
 *
 * MUST sit ABOVE the HTTP verb decorator, like every other decorator here.
 */
export const OAuthCallback = (provider: string, label = provider) =>
  SetMetadata(OAUTH_PROVIDER_KEY, {
    provider,
    label,
  } satisfies OAuthCallbackMeta);

export interface OAuthStateRequest extends Request {
  oauthState?: OAuthStatePayload;
}

/**
 * The verified state payload. Only ever populated by `OAuthStateGuard`, which
 * rejects the request outright when verification fails — so a handler that
 * receives this can trust `organizationId` without re-checking it.
 */
export const OAuthState = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OAuthStatePayload => {
    const req = ctx.switchToHttp().getRequest<OAuthStateRequest>();
    if (!req.oauthState) {
      // Unreachable via the guard; reachable if someone uses the decorator
      // without it. Fail loudly rather than handing back a hole.
      throw new Error(
        '@OAuthState() used on a route without OAuthStateGuard — the state ' +
          'would be unverified.'
      );
    }
    return req.oauthState;
  }
);

/** Raised when a callback's `state` does not verify. Rendered as a redirect. */
export class OAuthStateError extends Error {
  constructor(
    readonly provider: string,
    /** `?integration=` value, so the frontend shows the right provider's toast. */
    readonly label: string = provider
  ) {
    super(`Invalid or expired OAuth state for ${provider}`);
    this.name = 'OAuthStateError';
  }
}

export type OAuthStateGuardType = CanActivate;
