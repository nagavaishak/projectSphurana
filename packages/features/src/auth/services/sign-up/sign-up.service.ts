import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import { fireLoopsEvent } from '../../../shared/loops.js';
import { fireNotionLeadCreated } from '../../../shared/notion-crm.js';
import { verifyCaptcha } from '../verify-captcha/index.js';
import { checkSignupEmail } from './email-validation.js';
import { type SignUpInput, signUpSchema } from './sign-up.schema.js';
import type { SignUpAuthApi, SignUpResponse } from './sign-up.types.js';

// Re-export types for backward compatibility
export type { SignUpResponse, SignUpAuthApi } from './sign-up.types.js';

/**
 * Internal implementation of sign-up
 */
const signUpImpl = async (authApi: SignUpAuthApi, input: SignUpInput) => {
  // Validate input
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Reject junk / disposable-domain emails BEFORE creating an account or
  // triggering the Resend verification email. Bots skip the (optional) CAPTCHA
  // by simply not sending a token, so this format+domain gate is the cheap last
  // line that stops the "Invalid `to` field" email-send flood at its source.
  const emailRejection = checkSignupEmail(parsed.data.email);
  if (emailRejection) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Please use a valid, non-disposable email address.',
        { reason: emailRejection }
      )
    );
  }

  // Verify CAPTCHA if token provided
  if (parsed.data.captchaToken) {
    const captchaValid = await verifyCaptcha(parsed.data.captchaToken);
    if (!captchaValid) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'CAPTCHA verification failed. Please try again.'
        )
      );
    }
  }

  try {
    // Use provided auth API to create user and session
    const response = await authApi.signUpEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        name: parsed.data.name,
      },
      asResponse: true,
    });

    // Check if the response is ok
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message || 'Sign up failed';

      if (
        response.status === 409 ||
        errorMessage.toLowerCase().includes('already exists')
      ) {
        return err(
          new FeatureError(
            ErrorCodes.ALREADY_EXISTS,
            'User with this email already exists'
          )
        );
      }

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    const data = (await response.json()) as {
      user: {
        id: string;
        email: string;
        name: string;
        emailVerified: boolean;
        createdAt: string;
        updatedAt: string;
      };
      token: string;
    };

    // Better Auth returns null if user already exists
    if (!data || !data.user || !data.token) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'User with this email already exists'
        )
      );
    }

    // Better Auth sets the *signed* session token in the Set-Cookie header
    // (format: <token>.<base64-hmac>), but only the bare token in the body.
    // The controller forwards whatever we return to res.cookie(), so we must
    // prefer the signed value — otherwise /auth/session can't validate it.
    let signedToken = data.token;
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      const match = setCookieHeader.match(
        /(?:__Secure-)?better-auth\.session_token=([^;]+)/
      );
      if (match) {
        try {
          signedToken = decodeURIComponent(match[1]);
        } catch {
          signedToken = match[1];
        }
      }
    }

    // Fire marketing events (non-blocking)
    fireLoopsEvent({
      email: data.user.email,
      userId: data.user.id,
      eventName: 'signup',
      contactProperties: { firstName: data.user.name },
    });
    fireNotionLeadCreated(data.user.email, data.user.name);

    return ok({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        emailVerified: data.user.emailVerified,
        createdAt: new Date(data.user.createdAt),
        updatedAt: new Date(data.user.updatedAt),
      },
      session: {
        token: signedToken,
      },
    } as SignUpResponse);
  } catch (error) {
    // Extract error details from Better Auth response
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorBody =
      error &&
      typeof error === 'object' &&
      'body' in error &&
      typeof (error as { body?: unknown }).body === 'object'
        ? (error as { body: { message?: string; code?: string } }).body
        : null;

    // Log error to console and Sentry
    logError('auth.signUp', error, {
      feature: 'auth',
      extra: {
        email: input.email,
        errorMessage,
        errorBody,
      },
    });

    // Better Auth throws errors for existing users with specific messages
    if (
      errorMessage.toLowerCase().includes('already exists') ||
      errorMessage.toLowerCase().includes('user exists') ||
      errorBody?.code === 'USER_ALREADY_EXISTS' ||
      errorBody?.message?.toLowerCase().includes('already exists')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'User with this email already exists'
        )
      );
    }

    // Don't expose internal error details to clients
    // The original error is preserved in the cause for logging
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while creating your account. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Register a new user with email and password
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Sign-up input (email, password, name)
 * @returns Result with user and session or error
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await signUp(auth.api, {
 *   email: 'user@example.com',
 *   password: 'securepassword123',
 *   name: 'John Doe',
 * });
 *
 * if (result.success) {
 *   console.log('User created:', result.data.user);
 *   console.log('Session:', result.data.session);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const signUp = (authApi: SignUpAuthApi, input: SignUpInput) =>
  trackedResult('auth.signUp', () => signUpImpl(authApi, input), {
    properties: { email: input.email },
  });

/**
 * Result type for signUp
 */
export type SignUpResult = Awaited<ReturnType<typeof signUp>>;
