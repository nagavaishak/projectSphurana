import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const webEnv = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',

  server: {
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    // API URL for Next.js rewrites and server-side fetch
    API_URL: z.string().url().default('http://localhost:3000'),
    // Contentful CMS (blog content)
    CONTENTFUL_SPACE_ID: z.string().optional(),
    CONTENTFUL_ACCESS_TOKEN: z.string().optional(),
  },

  client: {
    // Either an absolute URL (staging/prod direct call) or a same-origin
    // relative path like '/nest' (used for vercel preview deployments where
    // the api is reached via the next.js rewrite proxy).
    NEXT_PUBLIC_API_URL: z
      .string()
      .refine(
        (v) => v.startsWith('/') || /^https?:\/\//.test(v),
        'NEXT_PUBLIC_API_URL must be an absolute URL or start with /'
      ),
    NEXT_PUBLIC_APP_URL: z.string().url(),
    // S3 bucket configuration for constructing public URLs
    NEXT_PUBLIC_S3_PUBLIC_ASSETS_BUCKET: z.string().min(1).optional(),
    NEXT_PUBLIC_S3_REGION: z.string().min(1).optional(),
    // CloudFront CDN
    NEXT_PUBLIC_CDN_URL: z.string().url().optional(),
    NEXT_PUBLIC_CDN_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Google Maps (Places Autocomplete)
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),
    // Cloudflare Turnstile (CAPTCHA)
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
    // Observability
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
    // Intercom support messenger
    NEXT_PUBLIC_INTERCOM_APP_ID: z.string().optional(),
    // Meta Facebook Login for Business — WhatsApp Embedded Signup
    NEXT_PUBLIC_META_APP_ID: z.string().optional(),
    NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
  },

  // Explicit mapping required for Next.js client components
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    API_URL: process.env.API_URL,
    CONTENTFUL_SPACE_ID: process.env.CONTENTFUL_SPACE_ID,
    CONTENTFUL_ACCESS_TOKEN: process.env.CONTENTFUL_ACCESS_TOKEN,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_S3_PUBLIC_ASSETS_BUCKET:
      process.env.NEXT_PUBLIC_S3_PUBLIC_ASSETS_BUCKET,
    NEXT_PUBLIC_S3_REGION: process.env.NEXT_PUBLIC_S3_REGION,
    NEXT_PUBLIC_CDN_URL: process.env.NEXT_PUBLIC_CDN_URL,
    NEXT_PUBLIC_CDN_ENABLED: process.env.NEXT_PUBLIC_CDN_ENABLED,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_INTERCOM_APP_ID: process.env.NEXT_PUBLIC_INTERCOM_APP_ID,
    NEXT_PUBLIC_META_APP_ID: process.env.NEXT_PUBLIC_META_APP_ID,
    NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID:
      process.env.NEXT_PUBLIC_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID,
  },

  emptyStringAsUndefined: true,
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === 'build' ||
    !!process.env.VITEST,
});
