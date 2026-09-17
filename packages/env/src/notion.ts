import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const notionEnv = createEnv({
  server: {
    NOTION_API_KEY: z.string().min(1).optional(),
    NOTION_CRM_DB_ID: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === 'build' ||
    !!process.env.VITEST,
});
