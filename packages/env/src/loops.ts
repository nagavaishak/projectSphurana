import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const loopsEnv = createEnv({
  server: {
    LOOPS_API_KEY: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === 'build' ||
    !!process.env.VITEST,
});
