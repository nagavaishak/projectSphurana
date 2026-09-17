import { runWithRlsContext } from '@borradh-workspace/database';
import { type ResultShape, logError } from '@borradh-workspace/observability';
import {
  type OAuthRedirectResult,
  type OAuthStatePayload,
  oauthRedirect,
  safeReturnTo,
} from '../../../shared/index.js';

/**
 * Every connect service is exported wrapped in `trackedResult`, whose return
 * type is `ResultShape<T>` (a structurally-compatible clone of `Result<T>`
 * whose error is a plain object rather than a `FeatureError` instance). Typing
 * `connect` as `Result<T>` therefore fails to compile against every real
 * caller — worth stating because it is the second time this distinction has
 * cost a build here.
 */
type ConnectFn<T, RequireUser extends boolean> = (ctx: {
  organizationId: string;
  /** Narrowed to `string` when `requireUserId` is set. */
  userId: RequireUser extends true ? string : string | undefined;
  code: string;
}) => Promise<ResultShape<T>>;

/**
 * The shared skeleton of every provider OAuth callback.
 *
 * All nine callbacks in `integrations.controller.ts` were the same steps
 * written longhand nine times: decode the state, bail if malformed, bind RLS
 * context, call the provider's connect service, and build a redirect. Only the
 * redirect shapes genuinely differed.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS FLATTEN THOSE DIFFERENCES. A first cut
 * assumed one redirect shape for all nine and would have silently broken three
 * of them:
 *
 *   - Instagram redirects `?instagram=error&message=…`, not
 *     `?integration=instagram&status=error` — the frontend keys off the
 *     provider-named param.
 *   - Calendly and Timely send FAILURES to a fixed `/dashboard/integrations`
 *     but SUCCESSES to the caller's `returnTo`, with a completely different
 *     param set (`integration=booking&provider=…&accountId=…`).
 *   - Meta Ads sends successes into its selection wizard at `/connect/meta-ads`.
 *
 * So the destination is supplied per provider by the thin wrappers in
 * `oauth-callbacks.ts`, and what is shared here is the part that is genuinely
 * identical: the provider-error branch, the RLS binding, the try/catch, the
 * error logging, and the analytics hook.
 *
 * The state arriving here is ALREADY VERIFIED — `OAuthStateGuard` rejected the
 * request otherwise — so `organizationId` is trustworthy and there is nothing
 * left to re-check. That is exactly what the old code could not claim: it
 * decoded and trusted in the same breath.
 */
export interface CompleteOAuthConnectInput<
  T,
  RequireUser extends boolean = false,
> {
  /** Verified by OAuthStateGuard. Never parse a raw state here. */
  state: OAuthStatePayload;
  /** Authorization code from the provider. */
  code: string | undefined;
  /** `?error=` the provider sent instead of a code, if any. */
  oauthError?: string;
  /** Human-readable detail the provider sent alongside `oauthError`. */
  oauthErrorDescription?: string;
  /** `{feature}.{action}` for logError. */
  operation: string;
  /**
   * The provider-specific connect service. `code` is guaranteed non-empty here
   * — the provider-error branch above returns before this is ever called — so
   * wrappers do not have to re-narrow it.
   */
  connect: ConnectFn<T, RequireUser>;
  /**
   * Set for providers whose connect schema requires `userId` (everything except
   * gmail and outlook, whose flows never carried one). When set, a state with
   * no userId fails with the same "Invalid OAuth state" message the old
   * handlers produced, instead of reaching the service and failing zod
   * validation with a less useful one.
   */
  requireUserId?: RequireUser;
  /** Where a successful connect lands. */
  onSuccess: (data: T, returnPath: string) => OAuthRedirectResult;
  /** Where any failure lands. `message` is absent for unexpected exceptions. */
  onFailure: (
    message: string | undefined,
    returnPath: string
  ) => OAuthRedirectResult;
  /** Shown when the provider reports an error or omits the code. */
  cancelledMessage?: string;
  /** Analytics hook. Never allowed to affect the redirect. */
  onOutcome?: (outcome: {
    status: 'success' | 'connect_failed' | 'provider_error' | 'exception';
    organizationId: string;
    errorCode?: string;
    error?: string;
    errorDescription?: string;
  }) => void;
}

export async function completeOAuthConnect<
  T,
  RequireUser extends boolean = false,
>(
  input: CompleteOAuthConnectInput<T, RequireUser>
): Promise<OAuthRedirectResult> {
  const {
    state,
    code,
    oauthError,
    oauthErrorDescription,
    operation,
    connect,
    onSuccess,
    onFailure,
    cancelledMessage = 'Connection cancelled. Please try again.',
    onOutcome,
    requireUserId,
  } = input;

  const { organizationId, userId } = state;
  const returnPath = safeReturnTo(state.returnTo);

  if (oauthError || !code) {
    onOutcome?.({
      status: 'provider_error',
      organizationId,
      error: oauthError,
      errorDescription: oauthErrorDescription,
    });
    return onFailure(oauthErrorDescription || cancelledMessage, returnPath);
  }

  if (requireUserId && !userId) {
    onOutcome?.({ status: 'connect_failed', organizationId });
    return onFailure('Invalid OAuth state', returnPath);
  }

  try {
    // These callbacks carry no AuthGuard, so RlsInterceptor bound no org
    // context. Bind it from the VERIFIED state so the nested withOrgScope in
    // the connect service enforces against the right org instead of
    // fail-fasting under RLS. No-op when RLS is off.
    const result = await runWithRlsContext({ organizationId, userId }, () =>
      connect({
        organizationId,
        userId,
        code,
      } as Parameters<ConnectFn<T, RequireUser>>[0])
    );

    if (!result.success) {
      onOutcome?.({
        status: 'connect_failed',
        organizationId,
        errorCode: result.error.code,
      });
      return onFailure(result.error.message, returnPath);
    }

    onOutcome?.({ status: 'success', organizationId });
    return onSuccess(result.data, returnPath);
  } catch (error) {
    logError(operation, error, {
      feature: 'integrations',
      extra: { organizationId },
    });
    onOutcome?.({ status: 'exception', organizationId });
    return onFailure(undefined, returnPath);
  }
}

/** The `?integration=<label>&status=…&message=…` shape seven callbacks use. */
export function statusRedirect(
  path: string,
  label: string,
  status: 'connected' | 'error',
  message?: string
): OAuthRedirectResult {
  return oauthRedirect(path, { integration: label, status, message });
}

export const INTEGRATIONS_PATH = '/dashboard/integrations';
