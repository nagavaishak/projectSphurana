import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  buildSessionCookieHeaders,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetSessionInput,
  getSessionSchema,
} from './get-session.schema.js';
import type {
  GetSessionAuthApi,
  SessionResponse,
} from './get-session.types.js';

// Re-export types for backward compatibility
export type {
  SessionResponse,
  GetSessionAuthApi,
} from './get-session.types.js';

/**
 * Internal implementation of get-session
 *
 * Uses Better Auth's getSession API with asResponse: true for proper
 * header/cookie handling in server-side contexts.
 */
const getSessionImpl = async (
  authApi: GetSessionAuthApi,
  input: GetSessionInput
) => {
  // Validate input
  const parsed = getSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // One definition of the cookie name, in shared/session-cookie-name.ts —
    // see the note there for why it is a constant and not a decision.
    const headers = buildSessionCookieHeaders(parsed.data.sessionToken);

    // Call Better Auth API with asResponse: true
    const response = await authApi.getSession({
      headers,
      asResponse: true,
    });

    if (!response.ok) {
      return err(
        new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired session')
      );
    }

    // Parse the response JSON to get session data
    const sessionData = (await response.json()) as SessionResponse &
      Record<string, unknown>;

    if (!sessionData || !sessionData.user) {
      return err(
        new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired session')
      );
    }

    // Check if session is expired
    if (
      sessionData.session?.expiresAt &&
      new Date(sessionData.session.expiresAt) < new Date()
    ) {
      return err(
        new FeatureError(ErrorCodes.UNAUTHORIZED, 'Session has expired')
      );
    }

    return ok({
      user: {
        id: sessionData.user.id,
        email: sessionData.user.email,
        name: sessionData.user.name,
        emailVerified: sessionData.user.emailVerified,
        role: sessionData.user.role ?? 'user',
        twoFactorEnabled: sessionData.user.twoFactorEnabled ?? false,
        createdAt: sessionData.user.createdAt,
        updatedAt: sessionData.user.updatedAt,
      },
      session: {
        id: sessionData.session?.id,
        expiresAt: sessionData.session?.expiresAt,
        activeOrganizationId: sessionData.session?.activeOrganizationId,
        impersonatedBy: sessionData.session?.impersonatedBy ?? undefined,
      },
    } as SessionResponse);
  } catch (error) {
    logError('auth.getSession', error, { feature: 'auth' });
    // Don't expose internal error details to clients
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while retrieving your session. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Get the current user session
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Get session input (sessionToken)
 * @returns Result with user and session or error
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await getSession(auth.api, {
 *   sessionToken: 'session-token-here',
 * });
 *
 * if (result.success) {
 *   console.log('Current user:', result.data.user);
 *   console.log('Session expires:', result.data.session.expiresAt);
 * } else {
 *   // Session invalid or expired
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const getSession = (
  authApi: GetSessionAuthApi,
  input: GetSessionInput
) =>
  trackedResult('auth.getSession', () => getSessionImpl(authApi, input), {
    properties: { hasSessionToken: !!input.sessionToken },
    internalErrorsOnly: true,
  });

/**
 * Result type for getSession
 */
export type GetSessionResult = Awaited<ReturnType<typeof getSession>>;
