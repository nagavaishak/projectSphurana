import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const storageEnv = createEnv({
  server: {
    // Multi-bucket configuration
    S3_PUBLIC_ASSETS_BUCKET: z.string().min(1), // Profile pictures, public images
    S3_ORG_ASSETS_BUCKET: z.string().min(1), // Organization assets for video creation
    S3_ANALYTICS_BUCKET: z.string().min(1).optional(), // Analytics snapshots for PostHog
    // Claire-Owner v3 image attachments (W-C11). Optional because the bucket
    // is provisioned by Pulumi at the same batch as this code; runtime
    // presence check lives in the sign-upload-url service.
    S3_ASSISTANT_UPLOADS_BUCKET: z.string().min(1).optional(),
    // Canonical image-generation template assets (content-addressed reference
    // PNGs). One bucket in the prod account, read by every env over public
    // HTTPS. Optional: only the publish step writes it, and seeds reference it
    // by the public base URL below; runtime presence checks live at use sites.
    S3_IMAGE_TEMPLATES_BUCKET: z.string().min(1).optional(),
    // Public base URL for the canonical image-templates bucket, e.g.
    // `https://borradh-prod-image-templates.s3.eu-west-1.amazonaws.com` (or a
    // CloudFront host once fronted). Same value in every environment.
    IMAGE_TEMPLATES_PUBLIC_BASE_URL: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ENDPOINT: z.string().url().optional(),
    // AWS SSO profile name (credentials resolved via AWS SDK credential chain)
    AWS_PROFILE: z.string().optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Legacy - keep for backward compatibility during migration
    S3_BUCKET: z.string().min(1).optional(),

    // CloudFront CDN configuration
    CDN_URL: z.string().url().optional(), // e.g., https://cdn.staging.borradh-testing.com
    CDN_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    CLOUDFRONT_KEY_PAIR_ID: z.string().optional(), // CloudFront public key ID for signed cookies
    CLOUDFRONT_PRIVATE_KEY: z.string().optional(), // RSA private key (PEM format) for signing
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === 'build' ||
    !!process.env.VITEST,
});
