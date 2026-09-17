import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const authEnv = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    // Web app URL for email verification links
    WEB_URL: z.string().url().default('http://localhost:3001'),
    // Dashboard app URL — where /verify-email and /reset-password live.
    // In prod this is app.borradh.io; WEB_URL is www.borradh.io (marketing).
    APP_URL: z.string().url().optional(),
    // Cookie domain for cross-subdomain sharing (e.g., .example.com)
    COOKIE_DOMAIN: z.string().optional(),
    // Google OAuth
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    // Apple OAuth
    APPLE_CLIENT_ID: z.string().optional(),
    APPLE_CLIENT_SECRET: z.string().optional(),
    APPLE_APP_BUNDLE_IDENTIFIER: z.string().optional(),
    // Admin impersonation - comma-separated user IDs
    ADMIN_USER_IDS: z
      .string()
      .optional()
      .transform((val) => (val ? val.split(',').map((id) => id.trim()) : [])),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  // Skip validation during Next.js build (CI) when env vars may not be available
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === 'build' ||
    !!process.env.VITEST,
});
