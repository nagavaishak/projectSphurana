/**
 * `trackedResult` widens a service's error to a PLAIN OBJECT
 * (`{ code, message, details? }`) rather than the `FeatureError` instance the
 * inner impl returned. So one tracked service cannot forward another tracked
 * service's error with a bare `err(other.error)` — it type-errors on the
 * missing `name`/`toJSON`.
 *
 * Rebuilding the instance is the fix, and doing it in one place keeps the error
 * CODE intact across the hop. Mapping everything to INTERNAL_ERROR instead
 * (the tempting shortcut) would turn a callee's NOT_FOUND into a 500 at the
 * controller.
 */

import { FeatureError } from '../../../shared/index.js';

export const toFeatureError = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);
