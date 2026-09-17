import { withSystemScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { finalizeAd } from '../finalize-ad/index.js';
import {
  type LaunchAdInput,
  type LaunchAdResponse,
  launchAd,
} from '../launch-ad/index.js';

/**
 * Launch an ad and START its finalization, returning as soon as the SYNCHRONOUS
 * launch has succeeded.
 *
 * This was the body of `POST /meta-ads/launch`. Finalization (poll Meta for
 * video readiness → create creative → create ad → activate campaign) takes
 * minutes and is deliberately NOT awaited: the caller gets the launched ad
 * immediately and polls for status. A finalization failure is logged, never
 * surfaced to this caller — the ad row carries the outcome.
 *
 * `finalizeAd` runs under `withSystemScope` because it continues after the
 * request's own scope is gone.
 *
 * NOTE: `launchAd` on its own does NOT finalize. `promoteDraftAd` (Claire's
 * publish path) calls `launchAd` directly and is unchanged by this.
 */
const launchAndFinalizeAdImpl = async (
  db: DbConnection,
  input: LaunchAdInput
): Promise<Result<LaunchAdResponse>> => {
  const result = await launchAd(db, input);
  if (!result.success) {
    return err(
      new FeatureError(
        result.error.code,
        result.error.message,
        result.error.details
      )
    );
  }

  const adId = result.data.ad.id;
  void withSystemScope((conn) => finalizeAd(conn, adId, input.organizationId), {
    db,
  }).catch((error) => {
    logError('metaAds.process', error, {
      feature: 'metaAds',
      extra: { adId },
    });
  });

  return ok(result.data);
};

export const launchAndFinalizeAd = (db: DbConnection, input: LaunchAdInput) =>
  trackedResult(
    'metaAds.launchAndFinalizeAd',
    () => launchAndFinalizeAdImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type LaunchAndFinalizeAdResult = Awaited<
  ReturnType<typeof launchAndFinalizeAd>
>;
