import { z } from 'zod';

const emptyToUndefined = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().min(1).optional()
);

const emptyToNull = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? null : v),
  z.union([z.string().min(1), z.null()])
);

const boolish = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true';
  return v;
}, z.boolean());

export const runtimeConfigSchema = z.object({
  apiUrl: z
    .string()
    .min(1)
    .refine(
      (v) =>
        /^https?:\/\//.test(v) || (v.startsWith('/') && !v.startsWith('//')),
      'apiUrl must be an absolute http(s) URL or a single-slash same-origin path'
    ),
  appUrl: z.string().url(),
  appEnv: z
    .enum(['development', 'preview', 'staging', 'production', 'test'])
    .default('production'),

  posthogKey: z.string().min(1),
  posthogHost: z.string().url(),

  sentryDsn: emptyToNull,
  sentryEnvironment: emptyToUndefined,
  marketingSentryDsn: emptyToNull,

  /**
   * Skip Sentry init on the WEB build of `apps/app`, leaving PostHog as the sole
   * error sink there. Native (iOS/Android via Capacitor) always initialises —
   * PostHog cannot see native crashes or ANRs, so Sentry is a permanent keep
   * there and this flag must never be able to turn it off.
   *
   * Named negatively ON PURPOSE. `boolish` treats unset/empty as `false`, so an
   * absent or misspelled env var leaves Sentry ON. A positively-named
   * `sentryWebEnabled` would fail the other way — one typo and web error
   * reporting silently disappears, which is precisely the class of bug this
   * whole PostHog migration exists to stamp out.
   */
  sentryWebDisabled: boolish,

  intercomAppId: emptyToNull,
  googleMapsApiKey: emptyToUndefined,
  turnstileSiteKey: emptyToUndefined,
  stripePublishableKey: emptyToUndefined,
  metaAppId: emptyToUndefined,
  metaLoginConfigId: emptyToUndefined,
  whatsappEmbeddedSignupConfigId: emptyToUndefined,

  cdnUrl: emptyToUndefined,
  cdnEnabled: boolish,
  s3PublicAssetsBucket: emptyToUndefined,
  s3Region: emptyToUndefined,
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
