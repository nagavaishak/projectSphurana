import { test } from '@playwright/test';

/**
 * External image-generation PROVIDER failure codes (see
 * packages/features/src/graphics/graphic-generation-errors.ts). The GFX-10xx
 * `MODEL_*` family is the upstream AI image provider — rate limited, billing/
 * quota exhausted, or the model itself failing to produce output. None of these
 * are a defect in our render pipeline; they are the same class of external
 * environment condition as a Meta rate-limit, so a connected spec that renders a
 * REAL graphic should SKIP on them rather than fail.
 *
 * Everything else the pipeline can report — GFX-2xxx (bad input / source image),
 * GFX-3xxx (our upload/save), GFX-9000 (unexpected) — is OUR side and must still
 * FAIL, so a genuine regression is never swallowed.
 */
const EXTERNAL_MODEL_ERROR_CODES = new Set([
  'GFX-1001', // MODEL_RATE_LIMITED
  'GFX-1002', // MODEL_BILLING_EXHAUSTED
  'GFX-1003', // MODEL_GENERATION_FAILED
]);

/**
 * Skip the current test iff a graphic render failed with an external
 * provider-side code. Call it with the failed graphic row's `errorCode` BEFORE
 * throwing a generic render-failure error, so an image-provider outage skips
 * cleanly while a real pipeline break still fails. Mirrors
 * `skipIfMetaUnavailable`.
 */
export function skipIfGraphicRenderUnavailable(
  errorCode: string | null | undefined,
  errorMessage?: string | null
): void {
  if (errorCode && EXTERNAL_MODEL_ERROR_CODES.has(errorCode)) {
    test.skip(
      true,
      `Image-generation provider unavailable (${errorCode}: ${errorMessage ?? 'no message'}) — external, retry once it recovers.`
    );
  }
}
