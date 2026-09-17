/**
 * REAL-AUTH integration harness.
 *
 * `buildControllerApp` in ./harness.ts overrides `AuthGuard` with a fake that
 * stamps a fixed identity onto the request. That is right for the ~70 specs
 * that care about a controller's behaviour GIVEN an identity — but it means
 * nothing in this suite exercises how an identity is RESOLVED.
 *
 * That gap is not academic. Impersonation broke in production precisely there:
 * `AuthGuard` reads `Authorization: Bearer` before the session cookie, while
 * Better Auth (which the impersonate endpoint forwards the raw Cookie header
 * to) reads the cookie. Swap one and not the other and the caller has two
 * identities at once. A fake guard cannot see that; only the real one can.
 *
 * So this harness registers the REAL `AuthGuard` and `GlobalAdminGuard`,
 * against real Better Auth, real Redis-backed sessions and the real Postgres
 * testcontainer. Sessions are minted through Better Auth's own internal
 * adapter rather than inserted as rows, because `secondaryStorage` is
 * configured — a hand-written `session` row would never be found.
 */
import { auth } from '@borradh-workspace/auth/server';
import { db, user } from '@borradh-workspace/database';
import {
  type INestApplication,
  type Provider,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { GlobalAdminGuard } from '../common/guards/global-admin.guard.js';
import { RoleGuard } from '../common/guards/role.guard.js';

export interface AuthenticatedApp {
  app: INestApplication;
  close: () => Promise<void>;
}

/**
 * Build an HTTP-testable Nest app hosting `controller` with the REAL auth
 * stack. No identity is stamped: callers authenticate by sending a cookie or
 * an Authorization header, exactly as a browser or the mobile app does.
 */
export async function buildAuthenticatedApp(
  // biome-ignore lint/suspicious/noExplicitAny: Nest's Type<> for a controller class
  controller: any,
  extraProviders: Provider[] = []
): Promise<AuthenticatedApp> {
  const moduleRef = await Test.createTestingModule({
    controllers: [controller],
    providers: [
      Reflector,
      AuthGuard,
      GlobalAdminGuard,
      RoleGuard,
      ...extraProviders,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  // The guards read `req.cookies`; without this they see undefined and every
  // cookie-authenticated request looks anonymous.
  app.use(cookieParser());
  app.useGlobalPipes(
    new ZodValidationPipe(),
    new ValidationPipe({ transform: true })
  );
  await app.init();

  return { app, close: () => app.close() };
}

export interface SignedUpUser {
  userId: string;
  email: string;
  /**
   * The session-cookie VALUE, which is Better Auth's signed `token.signature`
   * — not the bare session token.
   *
   * This is the same string the app hands a bearer client: `applySessionSetCookies`
   * lifts it straight out of Set-Cookie. Using the bare token instead fails
   * signature verification, and a session minted through
   * `internalAdapter.createSession` is never written to secondary storage
   * (that happens in `setSessionCookie`), so it cannot be resolved at all.
   * Both traps cost an afternoon; go through sign-up like the app does.
   */
  token: string;
}

/**
 * Create a real, VERIFIED user through Better Auth and return its live session.
 *
 * Three steps, and each one is load-bearing:
 *  1. sign up — mints the user, hashes a password, signs the cookie;
 *  2. flip `emailVerified` in the DB — `AuthGuard` refuses an unverified user
 *     with 403 "Email verification required", and sign-up always starts
 *     unverified;
 *  3. sign in AGAIN — the session cached in secondary storage carries a COPY of
 *     the user, so a session minted at step 1 still reports the stale
 *     `emailVerified: false`. Only a fresh sign-in re-reads the row.
 */
export async function signUpRealUser(input: {
  email: string;
  name?: string;
  password?: string;
}): Promise<SignedUpUser> {
  const password = input.password ?? 'int-test-password-123';

  const signUp = (await auth.api.signUpEmail({
    body: {
      email: input.email,
      password,
      name: input.name ?? 'Integration User',
    },
    asResponse: true,
  })) as globalThis.Response;
  if (!signUp.ok) {
    throw new Error(
      `sign-up failed for ${input.email}: ${signUp.status} ${await signUp.text()}`
    );
  }
  const signUpBody = (await signUp.json()) as { user?: { id?: string } };
  const userId = signUpBody.user?.id;
  if (!userId)
    throw new Error(`sign-up for ${input.email} returned no user id`);

  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));

  const signIn = (await auth.api.signInEmail({
    body: { email: input.email, password },
    asResponse: true,
  })) as globalThis.Response;
  if (!signIn.ok) {
    throw new Error(
      `sign-in failed for ${input.email}: ${signIn.status} ${await signIn.text()}`
    );
  }

  const setCookies =
    (signIn.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    [];
  const token = sessionTokenFromSetCookie(setCookies);
  if (!token) {
    throw new Error(`sign-in for ${input.email} returned no session cookie`);
  }

  return { userId, email: input.email, token };
}

/**
 * Sign an existing user in again and return a FRESH session token.
 *
 * Needed because a successful `verifyTOTP` rotates the session: the token that
 * passed the gate is dead immediately afterwards, so a spec reusing it gets
 * "Invalid or expired session" from AuthGuard — which reads like the endpoint
 * refusing the code, and quietly turns any "expect 401" assertion into a
 * tautology.
 */
export async function signInRealUser(input: {
  email: string;
  password?: string;
}): Promise<string> {
  const response = (await auth.api.signInEmail({
    body: {
      email: input.email,
      password: input.password ?? 'int-test-password-123',
    },
    asResponse: true,
  })) as globalThis.Response;
  if (!response.ok) {
    throw new Error(
      `sign-in failed for ${input.email}: ${response.status} ${await response.text()}`
    );
  }
  const setCookies =
    (response.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    [];
  const token = sessionTokenFromSetCookie(setCookies);
  if (!token) throw new Error(`sign-in for ${input.email} returned no cookie`);
  return token;
}

/**
 * A minimal cookie jar with BROWSER semantics.
 *
 * Necessary, not decorative: Better Auth's impersonate response carries a
 * DELETE and a SET for `__Secure-better-auth.session_token` in the same
 * Set-Cookie list (it clears the old session before writing the new one). A
 * browser applies them in order, so the last write wins. Naively mapping the
 * headers to `name=value` pairs instead sends BOTH, and Better Auth reads the
 * empty one — stop-impersonating then fails with "Failed to stop
 * impersonating" for a reason that exists only in the test.
 */
export class CookieJar {
  private readonly jar = new Map<string, string>();

  /** Apply a response's Set-Cookie headers, honouring deletes. */
  apply(setCookieHeaders: string[] | undefined): this {
    for (const header of setCookieHeaders ?? []) {
      const [pair, ...attributes] = header.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();

      const maxAge = attributes
        .map((a) => a.trim())
        .find((a) => /^max-age=/i.test(a));
      const expired = maxAge !== undefined && Number(maxAge.split('=')[1]) <= 0;

      if (value === '' || expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return this;
  }

  /** Set a cookie directly (for gates the server never issues in a test). */
  set(name: string, value: string): this {
    this.jar.set(name, value);
    return this;
  }

  /** The `Cookie` header this jar would send. */
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/**
 * The session cookie's NAME, derived the way Better Auth derives it.
 *
 * `useSecureCookies` is unset in our config, so better-auth falls back to
 * "does baseURL start with https" — and that flips between environments: a
 * developer .env points BETTER_AUTH_URL at an https tunnel (prefixed), while
 * CI runs with INT_SKIP_ROOT_ENV=1 against http://localhost:3000 (bare).
 * Hardcoding the prefixed name passes locally and fails every assertion in CI.
 */
export const SESSION_COOKIE_NAME = `${
  process.env.BETTER_AUTH_URL?.startsWith('https://') ? '__Secure-' : ''
}better-auth.session_token`;

/** The `Cookie` header a browser would send for `token`. */
export const sessionCookie = (token: string): string =>
  `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;

/**
 * The admin-terminal 2FA gate cookie.
 *
 * NOTE: `GlobalAdminGuard` only checks that this cookie is NON-EMPTY — the
 * value is unsigned and never verified. Mirrored here deliberately rather than
 * hidden behind a helper that implies more, and asserted in the spec.
 */
export const adminGateCookie = (userId: string): string =>
  `admin_2fa_verified=verified:${userId}:${Date.now()}`;

/** Read the session token Better Auth set on a response's Set-Cookie headers. */
export function sessionTokenFromSetCookie(
  headers: string[] | undefined
): string | undefined {
  const match = (headers ?? [])
    .join(', ')
    .match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
  if (!match || !match[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export { APP_GUARD };
