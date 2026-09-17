/**
 * Vercel credentials for custom-domain provisioning (microsites plan §9).
 *
 * The token is a SECRET with project-wide write scope. It is read here and
 * nowhere else — never `process.env.VERCEL_API_TOKEN` at a call site, never
 * echoed into an error message, never attached to a log record. The adapter in
 * `@borradh-workspace/integrations` is the only consumer.
 *
 * Every field is OPTIONAL on purpose. Custom domains are one feature of one
 * product surface; an API or worker booting in an environment that has no
 * Vercel project must not fail env validation over it (the CI env-validation
 * gate IS the deploy). The adapter factory reports NOT_CONFIGURED at call time
 * instead, which is a recoverable answer rather than a dead process.
 */

import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const vercelEnv = createEnv({
  server: {
    /** Personal/team access token with `domains` write scope. SECRET. */
    VERCEL_API_TOKEN: z.string().min(1).optional(),
    /** The project tenant domains are attached to (`prj_...`). */
    VERCEL_PROJECT_ID: z.string().min(1).optional(),
    /** Required when the project lives under a team rather than a user. */
    VERCEL_TEAM_ID: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === 'build' ||
    !!process.env.VITEST,
});
