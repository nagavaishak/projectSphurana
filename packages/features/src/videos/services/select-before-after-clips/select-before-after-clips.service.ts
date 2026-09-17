import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
} from '../../../shared/index.js';
import type {
  SelectBeforeAfterClipsInput,
  SelectBeforeAfterClipsOutput,
} from './select-before-after-clips.schema.js';

/**
 * RETIRED — always declines. See {@link RETIRED_TEMPLATE_IDS}.
 *
 * The premise below turned out to be false in production, so the format is
 * withdrawn rather than patched.
 *
 * The comment that used to sit here claimed we "never relabel an arbitrary
 * procedure clip as a transformation it isn't", on the grounds that the org
 * had *explicitly* tagged its media `before` / `after`. It hadn't. Those tags
 * are written by the vision model (`suggestedTags` offers a literal
 * `"before-after"` value, vision-analysis.service.ts:229), not by a person.
 *
 * Worse, the selection below took the first org-wide asset tagged `before` and
 * the first *different* asset tagged `after` — no service scoping and no
 * pairing by subject. A prod audit found 32 `before` and 32 `after` assets
 * across all orgs with `client_name` set on ZERO of them, so the number of
 * honestly pairable subjects was zero. Every before/after we shipped paired
 * two unrelated people, presented as one person's result.
 *
 * That is a false-advertising exposure, so we decline instead of generating.
 * The old implementation is preserved in git history if an honest version is
 * ever built — that version needs per-client media capture (same subject,
 * same treatment, consented), which the product does not have today.
 */
const RETIRED_MESSAGE =
  'Before/after videos have been withdrawn. We can only publish a before/after ' +
  'when both photos are confirmed to be the same client and the same treatment, ' +
  'and that information is not captured today — so any we generated risked ' +
  'pairing two different people. Try a different format in the meantime.';

const selectBeforeAfterClipsImpl = async (
  _db: DbConnection,
  _input: SelectBeforeAfterClipsInput
): Promise<Result<SelectBeforeAfterClipsOutput>> =>
  err(new FeatureError(ErrorCodes.VALIDATION_ERROR, RETIRED_MESSAGE));

export const selectBeforeAfterClips = (
  db: DbConnection,
  input: SelectBeforeAfterClipsInput
) =>
  trackedResult(
    'videos.selectBeforeAfterClips',
    () => selectBeforeAfterClipsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
      internalErrorsOnly: true,
    }
  );

export type SelectBeforeAfterClipsResult = Awaited<
  ReturnType<typeof selectBeforeAfterClips>
>;
