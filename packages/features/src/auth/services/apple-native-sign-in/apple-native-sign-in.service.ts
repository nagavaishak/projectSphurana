import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type AppleNativeSignInInput,
  appleNativeSignInSchema,
} from './apple-native-sign-in.schema.js';
import type {
  AppleNativeSignInAuthApi,
  AppleNativeSignInResponse,
} from './apple-native-sign-in.types.js';

// Re-export types for convenience
export type {
  AppleNativeSignInResponse,
  AppleNativeSignInAuthApi,
} from './apple-native-sign-in.types.js';

/**
 * Internal implementation of Apple native sign-in
 */
const appleNativeSignInImpl = async (
  authApi: AppleNativeSignInAuthApi,
  input: AppleNativeSignInInput
) => {
  // Validate input
  const parsed = appleNativeSignInSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Call Better Auth signInSocial with the Apple identity token
    const response = await authApi.signInSocial({
      body: {
        provider: 'apple',
        idToken: {
          token: parsed.data.identityToken,
        },
      },
      asResponse: true,
    });

    // Check if the response is ok
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message || 'Apple sign-in failed';

      if (response.status === 401) {
        return err(
          new FeatureError(
            ErrorCodes.UNAUTHORIZED,
            'Apple authentication failed'
          )
        );
      }

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    const rawData = await response.json();

    // Extract session token from set-cookie header (same as sign-in service)
    const setCookieHeader = response.headers.get('set-cookie');
    let sessionToken = '';

    if (setCookieHeader) {
      const cookieMatch = setCookieHeader.match(
        /(?:__Secure-)?better-auth\.session_token=([^;]+)/
      );
      if (cookieMatch) {
        const rawToken = cookieMatch[1];
        // Decode the token - Better Auth URL-encodes it in Set-Cookie header
        try {
          sessionToken = decodeURIComponent(rawToken);
        } catch {
          sessionToken = rawToken;
        }
      }
    }

    const data = rawData as {
      user: {
        id: string;
        email: string;
        name: string;
        emailVerified: boolean;
        createdAt: Date;
        updatedAt: Date;
      };
      token: string;
    };

    if (!data.user) {
      return err(
        new FeatureError(ErrorCodes.UNAUTHORIZED, 'Apple authentication failed')
      );
    }

    // Use the session token from cookies if available, otherwise fall back to body token
    const tokenToUse = sessionToken || data.token;

    if (!tokenToUse) {
      return err(
        new FeatureError(ErrorCodes.UNAUTHORIZED, 'No session token received')
      );
    }

    // If Apple provided the user's name (first sign-in only), update the user name
    // Apple only sends the name on the very first authorization
    const userName =
      data.user.name ||
      [parsed.data.fullName?.givenName, parsed.data.fullName?.familyName]
        .filter(Boolean)
        .join(' ') ||
      data.user.email.split('@')[0];

    return ok({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: userName,
        emailVerified: data.user.emailVerified,
        createdAt: data.user.createdAt,
        updatedAt: data.user.updatedAt,
      },
      session: {
        token: tokenToUse,
      },
    } as AppleNativeSignInResponse);
  } catch (error) {
    logError('auth.appleNativeSignIn', error, { feature: 'auth' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred during Apple sign-in. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Authenticate a user with Apple identity token (native iOS flow)
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Apple native sign-in input (identityToken, optional fullName)
 * @returns Result with user and session or error
 */
export const appleNativeSignIn = (
  authApi: AppleNativeSignInAuthApi,
  input: AppleNativeSignInInput
) =>
  trackedResult(
    'auth.appleNativeSignIn',
    () => appleNativeSignInImpl(authApi, input),
    {
      properties: { hasIdentityToken: !!input.identityToken },
    }
  );

/**
 * Result type for appleNativeSignIn
 */
export type AppleNativeSignInResult = Awaited<
  ReturnType<typeof appleNativeSignIn>
>;
