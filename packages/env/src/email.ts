import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const emailEnv = createEnv({
  server: {
    // Resend Configuration
    RESEND_API_KEY: z.string().min(1),

    // Platform email (mail. subdomain) — used for verification, invitations, etc.
    EMAIL_FROM_ADDRESS: z.string().email(),
    EMAIL_FROM_NAME: z.string().default('Borradh'),

    // Sequence email (send. subdomain) — dedicated for automated sequence emails
    SEQUENCE_FROM_ADDRESS: z.string().email(),

    // ============================================================
    // AWS SES Configuration (commented - using Resend instead)
    // ============================================================
    // AWS_SES_REGION: z.string().min(1).default('eu-west-1'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
