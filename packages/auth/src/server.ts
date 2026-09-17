import { db } from '@borradh-workspace/database';
import * as schema from '@borradh-workspace/database';
import {
  PasswordResetEmail,
  VerificationEmail,
  sendEmail,
} from '@borradh-workspace/email';
import { authEnv } from '@borradh-workspace/env/auth';
import { getRedis } from '@borradh-workspace/redis';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, apiKey, organization, twoFactor } from 'better-auth/plugins';
import { organizationSetup } from './organization-config.js';

// Simple logger for auth module
const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(`[AUTH] ${message}`, meta ? JSON.stringify(meta) : '');
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    console.error(`[AUTH] ${message}`, meta ? JSON.stringify(meta) : '');
  },
};

// Get Redis client for session storage (uses REDIS_URL from environment)
// Returns undefined if REDIS_URL is not set, making secondary storage optional
const getRedisClient = () => {
  try {
    const client = getRedis();
    return client;
  } catch (err) {
    // REDIS_URL not configured - secondary storage will be disabled
    logger.error('[E2E-DEBUG] getRedisClient failed', {
      error: err instanceof Error ? err.message : String(err),
      hasRedisUrl: !!process.env.REDIS_URL,
    });
    return undefined;
  }
};

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  baseURL: authEnv.BETTER_AUTH_URL,
  basePath: '/better-auth', // Avoid conflict with custom AuthController at /api/auth
  secret: authEnv.BETTER_AUTH_SECRET,
  // Configure cookies for cross-subdomain sharing (e.g., api.example.com -> app.example.com)
  advanced: {
    crossSubDomainCookies: authEnv.COOKIE_DOMAIN
      ? {
          enabled: true,
          domain: authEnv.COOKIE_DOMAIN, // e.g., .daniel.borradh-dev.com
        }
      : undefined,
    // When COOKIE_DOMAIN is set (prod, staging, local cloudflared tunnel) the
    // SPA and api share a parent domain, so SameSite=Lax correctly permits
    // cross-subdomain auth. When it's empty (per-PR previews on random
    // *.vercel.app + *.fly.dev hostnames) the two are unrelated sites, and
    // Lax would silently block the cookie on the post-sign-in /auth/session
    // XHR — sign-in succeeds, next request arrives without the cookie, and
    // the session check sees no user. Fall back to SameSite=None (which is
    // why `secure: true` is hardcoded; browsers reject `SameSite=None` over
    // plain HTTP) for cross-site auth in that mode.
    // Pin the `__Secure-` cookie-name prefix ON everywhere. Better Auth
    // otherwise derives it from `baseURL.startsWith('https://')`, so a local
    // API on http://localhost:3000 would read/write the UNPREFIXED name while
    // the API's own session-cookie.ts always writes `__Secure-…` — the two
    // disagree, every session lookup misses, and the browser gets its cookie
    // cleared on the next /auth/session. Matches `secure: true` below.
    useSecureCookies: true,
    defaultCookieAttributes: {
      sameSite: authEnv.COOKIE_DOMAIN ? 'lax' : 'none',
      secure: true,
      httpOnly: true,
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true, // Automatically sign in after sign-up
    // A password reset is what someone does when they have LOST control of
    // the credential — including when an attacker holds a stolen session
    // cookie. Leaving existing sessions alive means the reset changes the
    // password but not who is currently logged in, so the attacker keeps
    // access indefinitely and the victim's only remedy silently does nothing
    // about them.
    //
    // better-auth defaults this OFF. With it on, `resetPassword` calls
    // `internalAdapter.deleteSessions(userId)`, which is secondary-storage
    // aware: it reads `active-sessions-<userId>` from Redis, drops every
    // session token, then drops the index key. That matters here because our
    // sessions live ONLY in Redis (`secondaryStorage` below) — the `session`
    // table is empty in production, so a DB-only revoke would be a no-op.
    //
    // This deliberately signs the user out everywhere, including the device
    // they reset from. /reset-password's success screen already ends with a
    // "Sign in" link, so that lands correctly.
    //
    // NOTE: the change-password path is separate and already handled — the
    // API pins `revokeOtherSessions: true` (apps/api/src/auth/auth.controller.ts).
    // That one spares the CURRENT session by design: you still know the
    // password, you just typed it.
    revokeSessionsOnPasswordReset: true,
    // NOTE: requireEmailVerification is intentionally NOT enabled here yet —
    // it changes onboarding UX (new users must verify before reaching the
    // dashboard) and needs the onboarding/E2E flows updated first. Tracked as
    // a follow-up; the verification email is still sent on sign-up below.
    sendResetPassword: async ({ user, url, token }) => {
      // Better Auth passes the token directly as a parameter
      // Fall back to URL extraction for backwards compatibility
      if (!token) {
        const parsedUrl = new URL(url);
        token = parsedUrl.searchParams.get('token') ?? '';
      }

      // Store token in Redis for E2E test retrieval (when testing endpoints are enabled)
      logger.info('[E2E-DEBUG] sendResetPassword callback fired', {
        email: user.email,
        hasToken: !!token,
        tokenLen: token?.length ?? 0,
        hasSeedToken: !!process.env.E2E_SEED_TOKEN,
      });
      if (process.env.E2E_SEED_TOKEN && token) {
        try {
          const redis = getRedisClient();
          logger.info('[E2E-DEBUG] sendResetPassword redis client', {
            hasRedis: !!redis,
          });
          if (redis) {
            const key = `e2e:reset-token:${user.email}`;
            await redis.set(key, token, 'EX', 3600);
            const readBack = await redis.get(key);
            logger.info('[E2E-DEBUG] sendResetPassword redis write+readback', {
              key,
              writeVerified: readBack === token,
              readBackLen: readBack?.length ?? 0,
            });
          }
        } catch (err) {
          logger.error('[E2E-DEBUG] sendResetPassword redis FAILED', {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      } else {
        logger.info('[E2E-DEBUG] sendResetPassword SKIPPED redis', {
          reason: !process.env.E2E_SEED_TOKEN
            ? 'no E2E_SEED_TOKEN'
            : 'no token',
        });
      }

      const resetUrl = new URL(
        '/reset-password',
        authEnv.APP_URL ?? authEnv.WEB_URL
      );
      resetUrl.searchParams.set('token', token || '');

      // Don't await to prevent timing attacks (reveals if email exists)
      void sendEmail({
        to: user.email,
        subject: 'Reset your password',
        template: PasswordResetEmail,
        props: {
          name: user.name || 'there',
          resetUrl: resetUrl.toString(),
        },
      }).catch((error) => {
        logger.error('Failed to send password reset email', {
          userId: user.id,
          email: user.email,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  },
  user: {
    changeEmail: {
      enabled: true,
    },
  },
  emailVerification: {
    sendOnSignUp: true, // Automatically send verification email after sign-up
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url, token }) => {
      // Better Auth passes the token directly as a parameter
      // Fall back to URL extraction for backwards compatibility
      if (!token) {
        const parsedUrl = new URL(url);
        token = parsedUrl.searchParams.get('token') ?? '';
      }

      // Store token in Redis for E2E test retrieval (when testing endpoints are enabled)
      logger.info('[E2E-DEBUG] sendVerificationEmail callback fired', {
        email: user.email,
        hasToken: !!token,
        tokenLen: token?.length ?? 0,
        hasSeedToken: !!process.env.E2E_SEED_TOKEN,
      });
      if (process.env.E2E_SEED_TOKEN && token) {
        try {
          const redis = getRedisClient();
          logger.info('[E2E-DEBUG] sendVerificationEmail redis client', {
            hasRedis: !!redis,
          });
          if (redis) {
            const key = `e2e:verification-token:${user.email}`;
            await redis.set(key, token, 'EX', 3600);
            const readBack = await redis.get(key);
            logger.info(
              '[E2E-DEBUG] sendVerificationEmail redis write+readback',
              {
                key,
                writeVerified: readBack === token,
                readBackLen: readBack?.length ?? 0,
              }
            );
          }
        } catch (err) {
          logger.error('[E2E-DEBUG] sendVerificationEmail redis FAILED', {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      } else {
        logger.info('[E2E-DEBUG] sendVerificationEmail SKIPPED redis', {
          reason: !process.env.E2E_SEED_TOKEN
            ? 'no E2E_SEED_TOKEN'
            : 'no token',
        });
      }

      // E2E users get NO verification email — and that is the point.
      //
      // The send below is AWAITED and RE-THROWS on failure, so a wobbly email
      // provider fails the SIGN-UP. The suites create ~100 users per run across
      // ~26 workers, which bursts past the provider's rate limit; every throttled
      // send then became `An error occurred while creating your account`, and the
      // test died on a user it had just asked for. That was the dominant failure
      // in the tabs job (76 of 100).
      //
      // The email is pure waste here anyway: the token was just written to Redis
      // above (that is how the suite reads it), and provisioning force-verifies
      // the address a millisecond later. Nobody ever opens it.
      //
      // Gated on E2E_SEED_TOKEN — set only on test/preview environments, never in
      // production — AND on the reserved e2e address prefix, so a real user can
      // never silently lose their verification email.
      const isE2EUser =
        Boolean(process.env.E2E_SEED_TOKEN) &&
        /^e2e\.(test|local)\./i.test(user.email);
      if (isE2EUser) {
        logger.info('[E2E] Skipping verification email', { email: user.email });
        return;
      }

      // Build verification URL pointing to frontend page. The dashboard
      // (`/verify-email`) lives on the app subdomain, not www (marketing).
      const customVerificationUrl = new URL(
        '/verify-email',
        authEnv.APP_URL ?? authEnv.WEB_URL
      );
      customVerificationUrl.searchParams.set('token', token || '');

      // Await email - if it fails, sign-up fails (user may already be created)
      // User can request a new verification email if this happens
      try {
        await sendEmail({
          to: user.email,
          subject: 'Verify your email address',
          template: VerificationEmail,
          props: {
            name: user.name || 'there',
            verificationUrl: customVerificationUrl.toString(),
          },
        });
        logger.info('Verification email sent', {
          userId: user.id,
          email: user.email,
        });
      } catch (error) {
        logger.error('Failed to send verification email', {
          userId: user.id,
          email: user.email,
          error: error instanceof Error ? error.message : String(error),
        });
        // Re-throw to fail sign-up - user can request new verification email
        throw error;
      }
    },
  },
  // Use Redis as secondary storage for sessions (faster lookups)
  secondaryStorage: (() => {
    const redis = getRedisClient();
    if (!redis) return undefined;
    return {
      get: async (key: string) => {
        const value = await redis.get(key);
        const ttl = await redis.ttl(key);
        console.log(
          `[AUTH-REDIS] GET key=${key} found=${value !== null} ttl=${ttl}s valueLen=${value?.length ?? 0}`
        );
        return value ?? null;
      },
      set: async (key: string, value: string, ttl?: number) => {
        console.log(
          `[AUTH-REDIS] SET key=${key} ttl=${ttl ?? 'none'}s valueLen=${value.length}`
        );
        if (ttl) {
          await redis.set(key, value, 'EX', ttl);
        } else {
          await redis.set(key, value);
        }
      },
      delete: async (key: string) => {
        console.log(`[AUTH-REDIS] DEL key=${key}`);
        await redis.del(key);
      },
    };
  })(),
  // Trusted origins for better-auth's own request validation (separate from
  // express-level cors). We anchor the vercel preview match to THIS app's
  // previews only (borradh[-(web|app|marketing)]-<hash>-borradh-technologies)
  // rather than trusting the whole `*-borradh-technologies.vercel.app` team
  // wildcard. This mirrors `vercelPreviewPattern` in apps/api/src/main.ts.
  trustedOrigins: (request) => {
    const origins = [
      'http://localhost:3001', // Web app
      'http://localhost:8081', // Mobile (Expo)
      'https://appleid.apple.com', // Required for Sign in with Apple
      process.env.WEB_URL,
      process.env.MOBILE_URL,
    ].filter(Boolean) as string[];
    // Anchored PR preview pattern — only this app's deployments, not the
    // entire vercel team. Reflect the request Origin only when it matches.
    // Keep in sync with `vercelPreviewPattern` in apps/api/src/main.ts.
    const origin = request?.headers.get('origin');
    if (
      origin &&
      /^https:\/\/borradh(-(web|app|marketing))?-[a-z0-9-]+-borradh-technologies\.vercel\.app$/.test(
        origin
      )
    ) {
      origins.push(origin);
    }
    return origins;
  },
  plugins: [
    admin({
      adminUserIds: authEnv.ADMIN_USER_IDS,
      impersonationSessionDuration: 60 * 60, // 1 hour
    }),
    organization(organizationSetup),
    twoFactor({
      issuer: 'Borradh',
      skipVerificationOnEnable: false,
    }),
    apiKey({
      // Store API keys in Redis for fast lookups, with DB fallback
      storage: 'secondary-storage',
      fallbackToDatabase: true,
      // Default rate limiting for all API keys
      rateLimit: {
        enabled: true,
        timeWindow: 1000 * 60 * 60, // 1 hour
        maxRequests: 1000, // 1000 requests per hour
      },
      // API keys expire after 1 year by default
      keyExpiration: {
        defaultExpiresIn: 1000 * 60 * 60 * 24 * 90, // 90 days
      },
      // Enable metadata for storing organization info
      enableMetadata: true,
    }),
  ],
  // Social providers
  socialProviders: {
    ...(authEnv.GOOGLE_CLIENT_ID &&
      authEnv.GOOGLE_CLIENT_SECRET && {
        google: {
          clientId: authEnv.GOOGLE_CLIENT_ID,
          clientSecret: authEnv.GOOGLE_CLIENT_SECRET,
        },
      }),
    ...(authEnv.APPLE_APP_BUNDLE_IDENTIFIER && {
      apple: {
        clientId:
          authEnv.APPLE_CLIENT_ID || authEnv.APPLE_APP_BUNDLE_IDENTIFIER,
        clientSecret: authEnv.APPLE_CLIENT_SECRET || 'unused-for-native-only',
        appBundleIdentifier: authEnv.APPLE_APP_BUNDLE_IDENTIFIER,
      },
    }),
  },
});

export type Auth = typeof auth;

/**
 * Re-exported so callers do not reach past this package into better-auth.
 *
 * Better Auth stores the TOTP secret ENCRYPTED with the auth secret and
 * decrypts it on verify, so anything seeding a two_factor row (the E2E
 * platform-admin fixture) has to encrypt it the same way or every code fails.
 */
export { symmetricEncrypt } from 'better-auth/crypto';
