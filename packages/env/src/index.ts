// IMPORTANT: Do NOT re-export env configs from this file!
// Each createEnv() call validates at import time, so barrel exports
// would force ALL env vars to be validated regardless of which one you need.
//
// Use subpath imports instead:
//   import { databaseEnv } from '@borradh-workspace/env/database';
//   import { apiEnv } from '@borradh-workspace/env/api';
//   import { webEnv } from '@borradh-workspace/env/web';
//   import { authEnv } from '@borradh-workspace/env/auth';
//   import { emailEnv } from '@borradh-workspace/env/email';
//   import { redisEnv } from '@borradh-workspace/env/redis';
//   import { observabilityEnv } from '@borradh-workspace/env/observability';

export {};
