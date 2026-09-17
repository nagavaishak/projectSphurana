/**
 * Report that a service had no footage of its own to draw on.
 *
 * WHY THIS SIGNAL, AND NOT A CONFIDENCE THRESHOLD
 * -----------------------------------------------
 * The obvious guard against "the clip doesn't match the treatment" is a floor
 * on `service_stock_clip.score`, which the column's own comment promises
 * ("a weak top score makes the selector draw from the generic pool instead")
 * and which nothing implements.
 *
 * It was not implemented here either, because the number does not support it.
 * A production case: a Body Contouring service matched a laser-hair-removal
 * handpiece at 0.9 and an IPL handpiece at 0.8, from a 26-clip bank containing
 * no body-contouring footage whatsoever. The matcher's prompt already says
 * "it is correct to return FEWER picks (or none) rather than force a weak
 * match" — it simply did not comply. A floor at 0.7 would not have caught
 * either clip; a floor high enough to catch them would discard genuine
 * matches. That is the same self-reported-confidence problem the asset→service
 * links already showed (560 of 2,025 below 0.8, and the high ones no more
 * trustworthy). Thresholding an uninformative number produces confident
 * filtering, not correct filtering.
 *
 * What IS knowable without trusting any model output is whether the
 * organization has uploaded anything for this service. That is a row count.
 * It is also the fact the owner can act on — the honest message is "you have
 * no footage for Body Contouring", not "our matcher scored a clip 0.8".
 *
 * WHY A LOG LINE RATHER THAN A DIRECT SLACK CALL
 * ----------------------------------------------
 * Slack credentials exist in this repo only as GitHub Actions secrets
 * (`SLACK_WEBHOOK_PROD` / `SLACK_WEBHOOK_STAGING`); there is no runtime Slack
 * path in the API or the worker, and adding one means a new secret in every
 * environment. A structured log with a STABLE event name routes to Slack
 * through the alerting that already exists (Better Stack alert → channel), and
 * it is queryable historically, which a fire-and-forget webhook is not.
 *
 * Query it as: `event:"content.footage_gap" AND env:production`
 * Alert on it grouped by `serviceId` so a twelve-video batch for one service is
 * one notification rather than twelve.
 */

import { createLogger } from '@borradh-workspace/observability';

const logger = createLogger('FootageGap');

/** Stable across renames — the alert query keys on this string. */
export const FOOTAGE_GAP_EVENT = 'content.footage_gap';

export interface FootageGapReport {
  organizationId: string;
  serviceId: string;
  /** For a message a human can read without joining tables. */
  serviceName?: string | null;
  /** Transcode-ready clips the ORG uploaded for this service. Zero is the gap. */
  ownClipCount: number;
  /** Curated stock admitted to this service's rotation pool. */
  stockPoolSize: number;
  /** Own media excluded by the quality floor — a different problem, same symptom. */
  excludedForQuality?: number;
  /** Which selector observed it, so the two paths stay distinguishable. */
  selector: string;
  /** The video or graphic this was noticed while producing. */
  subjectId?: string;
}

/**
 * Emit the gap signal. Never throws — a diagnostic must not fail a render.
 *
 * Emitted per render rather than deduped in code: the repeat count is itself
 * the useful number (how often this bit an owner), and grouping belongs in the
 * alert, where it can be tuned without a deploy.
 */
export function reportFootageGap(report: FootageGapReport): void {
  if (report.ownClipCount > 0) return;

  try {
    logger.warn('Service has no footage of its own', {
      event: FOOTAGE_GAP_EVENT,
      ...report,
      // Distinguishes the two ways a service ends up with nothing usable:
      // never uploaded anything, versus uploaded only material the quality
      // floor rejects. The advice to the owner differs.
      gapKind:
        (report.excludedForQuality ?? 0) > 0
          ? 'own_media_below_quality_floor'
          : 'no_own_media',
      // True when the render was carried ENTIRELY by stock — the state most
      // likely to produce "that isn't my clinic" and "that's the wrong
      // treatment", because nothing in the video came from this business.
      renderedEntirelyFromStock: report.stockPoolSize > 0,
    });
  } catch {
    // Observability is never a gate.
  }
}
