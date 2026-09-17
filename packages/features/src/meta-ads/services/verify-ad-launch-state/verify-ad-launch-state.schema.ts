import { z } from 'zod';

/**
 * Honest-state union for a launch/pause/resume/budget mutation (ADR-005).
 *
 * Reported ONLY from a Meta read-back — never from the intent we sent.
 *
 *  - `live`                     — ad effective_status ACTIVE and the parent
 *                                 campaign is delivering.
 *  - `live_but_campaign_paused` — the ad itself is approved/active but the
 *                                 parent campaign is PAUSED, so nothing is
 *                                 delivering (#105).
 *  - `pending_review`           — submitted, sitting in Meta review.
 *  - `paused_at_meta`           — the ad (or its ad set) is paused on Meta.
 *  - `rejected`                 — Meta disapproved the ad.
 *  - `failed`                   — Meta reports the ad errored / has issues /
 *                                 was deleted.
 *  - `unverified`               — the mutation was submitted but the read-back
 *                                 itself failed. We do NOT know the state and
 *                                 must never report the ad as live.
 */
export const adLaunchStateValues = [
  'live',
  'live_but_campaign_paused',
  'pending_review',
  'paused_at_meta',
  'rejected',
  'failed',
  'unverified',
] as const;

export type AdLaunchState = (typeof adLaunchStateValues)[number];

export const verifyAdLaunchStateSchema = z.object({
  /** The Meta ad id (the id on Meta's side, not our row id). */
  metaAdId: z.string().min(1, 'Meta ad ID is required'),
  /** The parent Meta campaign id — read back alongside the ad (#105). */
  metaCampaignId: z.string().min(1, 'Meta campaign ID is required'),
});

export type VerifyAdLaunchStateInput = z.infer<
  typeof verifyAdLaunchStateSchema
>;
