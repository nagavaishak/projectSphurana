import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const redisEnv = createEnv({
  server: {
    REDIS_URL: z.string().url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
