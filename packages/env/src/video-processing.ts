import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * whisper.cpp model names.
 *
 * MUST match `WhisperModel` in
 * `packages/video-processing/src/whisper/types.ts` — that union is what
 * `createConfigFromEnv()` casts `process.env.WHISPER_MODEL` to, and its default
 * is `'base.en'`, which is also what `.github/prod.env` sets.
 *
 * This enum previously listed only `['tiny','base','small','medium','large']`,
 * i.e. it REJECTED the value production actually ships. That is why this module
 * had to be fixed before it could be wired into the worker: adopting it as-is
 * would have crash-looped prod on boot.
 *
 * `managed-env.test.ts` is the gate — it parses the real `.github/*.env` files
 * against this schema, so a value prod sets can never again fail to parse here.
 */
export const whisperModelValues = [
  'tiny',
  'tiny.en',
  'base',
  'base.en',
  'small',
  'small.en',
  'medium',
  'medium.en',
  'large-v1',
  'large-v2',
  'large-v3',
  'large-v3-turbo',
] as const;

/**
 * The video worker's env contract.
 *
 * Exported as a bare schema (not just the validated object) so gates can parse
 * arbitrary env sources — e.g. the checked-in `.github/prod.env` — without
 * mutating `process.env`.
 */
export const videoProcessingEnvSchema = {
  // ── Remotion Lambda ────────────────────────────────────────────────────────
  // REQUIRED. Without these the worker still boots green, passes its health
  // check, drains the queue and FAILS EVERY RENDER (`renderAndWait` against an
  // empty function name). A missing render target is a boot-time error, not a
  // per-job surprise.
  REMOTION_FUNCTION_NAME: z.string().min(1),
  REMOTION_SERVE_URL: z.string().url(),
  REMOTION_AWS_REGION: z.string().min(1).default('us-east-1'),

  // ── Whisper (local transcription) ──────────────────────────────────────────
  WHISPER_MODEL: z.enum(whisperModelValues).default('base.en'),
  WHISPER_INSTALL_PATH: z.string().default('./whisper'),
  WHISPER_VERSION: z.string().default('1.5.5'),
  WHISPER_VERBOSE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // ── Video processing ───────────────────────────────────────────────────────
  VIDEO_WORKER_CONCURRENCY: z.coerce.number().int().positive().optional(),
  VIDEO_RENDER_CONCURRENCY: z.coerce.number().default(2),
  VIDEO_CACHE_SIZE_MB: z.coerce.number().default(512),
  TEMP_DIR_PATH: z.string().default('./tmp'),
  VIDEOS_DIR_PATH: z.string().default('./videos'),

  // ── OpenAI (cloud transcription + vision analysis) ─────────────────────────
  // Optional: absent → `createConfigFromEnv()` falls back to local whisper.cpp.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_VISION_MODEL: z.string().default('gpt-5.6-luna'),

  // ── Asset analysis ─────────────────────────────────────────────────────────
  ASSET_ANALYSIS_CONCURRENCY: z.coerce.number().default(2),
  VISION_FRAMES_COUNT: z.coerce.number().default(5),

  // ── E2E contract fake ──────────────────────────────────────────────────────
  // The worker makes Meta calls too — chatbot delivery (execute-flow) and
  // meta-sync — so it needs the same stub flag as the API. A stubbed API next
  // to a live worker is worse than neither: half the traffic escapes to real
  // Meta and the failure looks like a product bug.
  //
  // Optional with a default, so adding it can't break the `managed-env` gate
  // that parses the checked-in `.github/*.env` files against this schema.
  META_E2E_STUB: z.coerce.boolean().default(false),
  META_CONTRACT_RECORD: z.coerce.boolean().default(false),
  META_CONTRACT_RECORD_DIR: z.string().optional(),
  META_CONTRACT_VALIDATE: z.coerce.boolean().default(false),
} as const;

/**
 * Validated at IMPORT time (like every other `createEnv` in this package), so
 * `apps/video-worker/src/main.ts` importing this module IS the boot gate: a
 * missing `REMOTION_FUNCTION_NAME` / `REMOTION_SERVE_URL` throws before the
 * worker registers a single BullMQ consumer.
 */
export const videoProcessingEnv = createEnv({
  server: videoProcessingEnvSchema,
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION || !!process.env.VITEST,
});
