import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const databaseEnv = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    // Role-specific connection strings for RLS (Phase 2 / I3). Optional: when
    // unset, the role-scoped pools fall back to DATABASE_URL, so nothing
    // changes until an environment provisions the roles + sets these. The API
    // process uses _AUTHENTICATED for authed routes and _PUBLIC for the open
    // booking flow; workers/webhooks use _SYSTEM (BYPASSRLS). Passwords come
    // from the per-env secret store (provision-role-passwords.mjs), never VCS.
    DATABASE_URL_AUTHENTICATED: z.string().url().optional(),
    DATABASE_URL_PUBLIC: z.string().url().optional(),
    DATABASE_URL_SYSTEM: z.string().url().optional(),
    // Patient portal (ENG-647): least-privilege app_patient role for
    // signed-in patient sessions.
    //
    // NOT the same fallback semantics as the roles above. `withPatientScope`
    // FAILS CLOSED when RLS is on and this is unset, rather than falling back
    // to the owner pool — because the patient tables use ENABLE (not FORCE)
    // row-level security, so the owner bypasses every `patient_self` policy
    // and the fallback would be a silent cross-patient read.
    //
    // Optional here only so non-RLS environments need not set it. It MUST be
    // set in any environment BEFORE `RLS_ENABLED` is flipped on, or every
    // patient-portal request throws.
    DATABASE_URL_PATIENT: z.string().url().optional(),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    // Master switch for Row-Level Security. Default `false` keeps the RLS
    // context helpers (withOrgScope etc. in rls-context.ts) fully inert — they
    // pass straight through to `db` with NO transaction — so behavior is
    // unchanged until the flag is flipped per environment. Mirrors apiEnv's
    // RLS_ENABLED; lives here too because the helpers run in any process that
    // imports @borradh-workspace/database (api, worker, webhook-router).
    // Flip to true ONLY after the policy migration + role switch are in place.
    RLS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
