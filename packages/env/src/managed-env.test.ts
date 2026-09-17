import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  videoProcessingEnvSchema,
  whisperModelValues,
} from './video-processing.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MANAGED-ENV GATE
 *
 * `.github/prod.env` and `.github/preview.env` are two hand-maintained lists
 * that are supposed to describe the same system in two environments. Nothing
 * compared them, so they drifted in BOTH directions:
 *
 *   - prod-only  → the whole `CLAIRE_WHATSAPP_*` surface is live in production
 *                  and exercised by NO preview and NO e2e run.
 *   - "prod-only" that shouldn't be → `S3_ASSISTANT_UPLOADS_BUCKET` was absent
 *                  from preview, so `sign-upload-url.service.ts` threw and
 *                  Claire image attachments 500'd in every preview while
 *                  working fine in prod. Reversed polarity, equally corrosive.
 *
 * The gate's input is DERIVED: it parses the actual env files. It cannot fail
 * to mention a var that was added to one file and not the other. The only way
 * to be asymmetric is to say so, in writing, below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const parseEnvFile = (path: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return out;
};

const prod = parseEnvFile(resolve(repoRoot, '.github/prod.env'));
const preview = parseEnvFile(resolve(repoRoot, '.github/preview.env'));

/**
 * A var may be present in prod.env and absent from preview.env ONLY if it is
 * listed here with a reason a human reads in review. "It happens to be missing"
 * is not a reason.
 */
const INTENTIONALLY_PROD_ONLY: Record<string, string> = {
  META_LOGIN_CONFIG_ID:
    'Facebook Login for Business configuration id. A configuration belongs to ' +
    'ONE Meta app, and preview runs a different app (1454249449494844) from ' +
    'prod (1508952006832817), so the prod value is not merely unnecessary ' +
    'here — it would be wrong, and the dialog would reject it. Give preview ' +
    'its own configuration id from the preview app to exercise the ' +
    'self-serve link there; until then getSelfServeMetaLink returns a clear ' +
    'INVALID_STATE naming this var rather than building a broken URL.',
  APP_URL:
    'Per-deployment SPA hostname. Every preview serves the SPA from a random ' +
    '*.vercel.app minted by Vercel at deploy time, so it cannot be a static ' +
    'value in this file. NOTE: pr-preview.yml does not set it either, so ' +
    'apiEnv.APP_URL is undefined on previews (auth falls back to WEB_URL). ' +
    'Flagged for the workflow owner.',
  BETTER_AUTH_URL:
    'Per-PR Fly hostname. Set by pr-preview.yml (api AND worker — the worker ' +
    'transitively imports @borradh-workspace/env/auth and crash-loops without it).',
  COOKIE_DOMAIN:
    'Must be ACTUALLY UNSET on previews — pr-preview.yml runs `flyctl secrets ' +
    'unset COOKIE_DOMAIN` so set-cookie carries no Domain attribute and the ' +
    'cookie is scoped to the api origin (the SPA is on an unrelated hostname).',
  POSTHOG_API_KEY:
    'Set unconditionally by pr-preview.yml AFTER the base import, on both api ' +
    'and worker, so it deliberately does not live in preview.env.',
  RLS_ENABLED:
    'Prod pins this to false (RLS broke prod 2026-06-13). Previews turn it on ' +
    'per-PR from pr-preview.yml when the RLS role URLs are present.',
  CLAIRE_V3_ENABLED:
    'Deprecated no-op since 2026-04-26 (see packages/env/src/api.ts) — kept on ' +
    'prod only so the existing Pulumi/Fly config keeps validating. Delete from ' +
    'both the schema and this file together.',
  NOTION_CRM_DB_ID:
    'Deliberate: previews must not write throwaway test orgs into the real ' +
    'Notion CRM database.',
  API_URL:
    'Per-PR Fly hostname. Set by pr-preview.yml on BOTH api and worker ' +
    '(the worker signs unsubscribe links, and getTrackingBaseUrl() throws in ' +
    'production when it is unset), so it cannot be a static value here.',
  CAMPAIGN_PUBLIC_BASE_URL:
    'Per-PR Fly hostname, same as API_URL — set by pr-preview.yml on api and ' +
    'worker.',
  CAMPAIGNS_SMS_WEBHOOK_URL:
    'Per-PR Fly hostname (derived from api_url + /webhooks/twilio/sms). Set by ' +
    'pr-preview.yml. Inert on previews anyway: CAMPAIGNS_DRY_RUN=true means no ' +
    'number is ever bought, so nothing is ever configured to call it.',
  SENTRY_DSN:
    'Preview must not share the production Sentry project: Sentry groups ' +
    'issues by project across environments, so an intentional preview debug ' +
    'probe would create a production-looking incident. Keep it unset until a ' +
    'dedicated preview Sentry DSN is provisioned.',

  // ── KNOWN TESTING GAP — not a healthy exemption ────────────────────────────
  // Claire-on-WhatsApp is LIVE IN PRODUCTION and is exercised by no preview and
  // no e2e run. There is no preview WhatsApp Business Account / phone number to
  // point at; provisioning a test WABA is a human action. Until then a
  // Claire-on-WhatsApp regression is undetectable before it reaches customers.
  CLAIRE_WHATSAPP_ENABLED:
    'TESTING GAP: no preview WABA exists. Claire-on-WhatsApp is prod-only and ' +
    'therefore never exercised before release. Provision a test WABA to close.',
  CLAIRE_WHATSAPP_PHONE_NUMBER_ID: 'TESTING GAP: see CLAIRE_WHATSAPP_ENABLED.',
  CLAIRE_WHATSAPP_NUMBER: 'TESTING GAP: see CLAIRE_WHATSAPP_ENABLED.',
  CLAIRE_WHATSAPP_PROACTIVE_ENABLED:
    'TESTING GAP: see CLAIRE_WHATSAPP_ENABLED.',
  CLAIRE_WHATSAPP_BUSINESS_ACCOUNT_ID:
    'TESTING GAP: see CLAIRE_WHATSAPP_ENABLED.',
};

/** Same contract, other direction. Empty today — keep it that way. */
const INTENTIONALLY_PREVIEW_ONLY: Record<string, string> = {
  // The preview API ships logs to a dedicated "Preview API (Fly)" Better Stack
  // source in a different data region, whose token is only accepted by its own
  // ingesting host — so previews must set LOGTAIL_ENDPOINT. Prod's source token
  // is accepted by @logtail/node's default endpoint, so prod deliberately does
  // NOT set this (unset = default host). Not reversed-polarity drift.
  LOGTAIL_ENDPOINT:
    'Preview uses a region-specific Better Stack ingesting host; prod uses the default endpoint.',
};

describe('.github/prod.env ⇄ .github/preview.env', () => {
  it('every prod-only var is either in preview.env or explicitly excused', () => {
    const unexcused = [...prod.keys()]
      .filter((k) => !preview.has(k))
      .filter((k) => !INTENTIONALLY_PROD_ONLY[k]);

    expect(
      unexcused,
      `Set in .github/prod.env but NOT in .github/preview.env:\n  ${unexcused.join('\n  ')}\n\nAdd it to preview.env, or add it to INTENTIONALLY_PROD_ONLY in this file WITH A WRITTEN REASON. A var that is live in prod and absent from every preview is a regression you cannot catch before customers do.`
    ).toEqual([]);
  });

  it('every preview-only var is either in prod.env or explicitly excused', () => {
    const unexcused = [...preview.keys()]
      .filter((k) => !prod.has(k))
      .filter((k) => !INTENTIONALLY_PREVIEW_ONLY[k]);

    expect(
      unexcused,
      `Set in .github/preview.env but NOT in .github/prod.env:\n  ${unexcused.join('\n  ')}\n\nReversed-polarity drift: the feature works on previews and is dead in production. Add it to prod.env, or excuse it in INTENTIONALLY_PREVIEW_ONLY with a written reason.`
    ).toEqual([]);
  });

  it('no stale excuses (an allowlisted var must actually be asymmetric)', () => {
    // The allowlist is itself hand-written, so it rots. If someone adds a var
    // to preview.env, its excuse here must go — otherwise the next asymmetry
    // slips through under a stale reason.
    const stale = [
      ...Object.keys(INTENTIONALLY_PROD_ONLY).filter(
        (k) => !prod.has(k) || preview.has(k)
      ),
      ...Object.keys(INTENTIONALLY_PREVIEW_ONLY).filter(
        (k) => !preview.has(k) || prod.has(k)
      ),
    ];
    expect(
      stale,
      `These vars are excused as environment-only but are no longer asymmetric (or no longer exist). Delete the excuse:\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });

  /**
   * Push delivery is the one asymmetry that must NEVER be normalised away.
   *
   * A per-PR Neon branch is created `--parent main`, so a preview database is a
   * copy-on-write fork of prod and `device_push_token` holds real customers'
   * real devices. Two different mechanisms keep a preview run from reaching
   * those phones, and they are easy to "tidy up" into symmetry by someone who
   * doesn't know why they differ:
   *
   *   APNs — has a sandbox. APNS_PRODUCTION=false points preview at
   *          api.sandbox.push.apple.com, where production tokens are invalid.
   *   FCM  — has no sandbox. Only the dryRun flag stands between a preview run
   *          and a real notification on a real phone.
   *
   * Flipping either preview value is a customer-visible incident, not a config
   * tweak. Flipping either prod value silently stops all notifications, which
   * is the exact failure #798 shipped with from launch until 2026-08-11.
   */
  it('never lets a preview deliver a real push, and never stops prod delivering', () => {
    expect(
      preview.get('FCM_DRY_RUN'),
      'preview.env must set FCM_DRY_RUN=true — FCM has no sandbox, and preview DBs are forks of prod, so real Android devices are one un-guarded send away.'
    ).toBe('true');
    expect(
      preview.get('APNS_PRODUCTION'),
      'preview.env must set APNS_PRODUCTION=false so preview talks to the APNs sandbox, where production device tokens are not valid.'
    ).toBe('false');

    expect(
      prod.get('FCM_DRY_RUN'),
      'prod.env must set FCM_DRY_RUN=false or Android notifications validate and silently deliver nothing.'
    ).toBe('false');
    expect(
      prod.get('APNS_PRODUCTION'),
      'prod.env must set APNS_PRODUCTION=true or iOS notifications go to the sandbox endpoint and never arrive.'
    ).toBe('true');
  });

  it('every excuse carries a non-trivial written reason', () => {
    for (const [key, reason] of [
      ...Object.entries(INTENTIONALLY_PROD_ONLY),
      ...Object.entries(INTENTIONALLY_PREVIEW_ONLY),
    ]) {
      expect(
        reason.length,
        `${key}: reason is too short to be a real reason`
      ).toBeGreaterThan(30);
    }
  });
});

describe('managed env parses against the schemas that consume it', () => {
  // The video worker now validates its env AT BOOT (createEnv throws on import
  // in apps/video-worker/src/main.ts). That makes a schema/prod-value mismatch
  // a CRASH LOOP rather than a warning — which is exactly what would have
  // happened with the old `WHISPER_MODEL: z.enum(['tiny','base',...])` against
  // prod's real `WHISPER_MODEL=base.en`. This test is the thing that stops that
  // from ever being true again: its input is the real env file.
  const schema = z.object(videoProcessingEnvSchema).partial();

  for (const [name, file] of [
    ['prod.env', prod],
    ['preview.env', preview],
  ] as const) {
    it(`${name} satisfies videoProcessingEnvSchema`, () => {
      const declared = Object.fromEntries(
        Object.keys(videoProcessingEnvSchema)
          .filter((k) => file.has(k))
          .map((k) => [k, file.get(k)])
      );
      const result = schema.safeParse(declared);
      expect(
        result.success
          ? []
          : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        `.github/${name} sets a value the video worker's env schema REJECTS. The worker validates at boot — this would crash-loop it.`
      ).toEqual([]);
    });
  }
});

describe('whisper model vocabulary', () => {
  // Derived, not hand-compared: read the real `WhisperModel` union out of
  // packages/video-processing and assert the env enum covers exactly it.
  // packages/env cannot import video-processing (it would be a dependency
  // cycle: env → video-processing → database → env), so the artifact is read
  // from disk rather than restated.
  it('matches WhisperModel in packages/video-processing', () => {
    const src = readFileSync(
      resolve(repoRoot, 'packages/video-processing/src/whisper/types.ts'),
      'utf8'
    );
    const union = src.match(/export type WhisperModel =([\s\S]*?);/)?.[1];
    expect(
      union,
      'could not find `export type WhisperModel` — did it move?'
    ).toBeTruthy();

    const declared = [...(union as string).matchAll(/'([^']+)'/g)].map(
      (m) => m[1]
    );
    expect([...whisperModelValues].sort()).toEqual([...declared].sort());
  });
});
