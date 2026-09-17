import type { BusinessProfile } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { getBusinessProfile } from '../services/get-business-profile/index.js';

const MAX_RANKED_LINES = 3;
const MAX_OBJECTION_LINES = 5;

/**
 * Build a system-prompt block describing what Claire knows about this
 * business — the 3-axis classification + top 3 ranked services + offer
 * strategy + objection handlers.
 *
 * Returned as plain markdown for the controller to append to Block 4
 * (the per-org business-context block). The chat controller calls this
 * helper on conversation open; subsequent turns inherit via cache.
 *
 * Returns `null` (not an error) when there's no profile yet — that means
 * Claire is still classifying and should NOT pretend to have ranked picks.
 */
const buildBusinessProfileContextImpl = async (
  db: DbConnection,
  organizationId: string
): Promise<Result<string | null>> => {
  if (!organizationId) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'organizationId required')
    );
  }
  const profile = await getBusinessProfile(db, { organizationId });
  if (!profile.success) {
    if (profile.error.code === ErrorCodes.NOT_FOUND) {
      return ok(null);
    }
    return err(new FeatureError(profile.error.code, profile.error.message));
  }
  return ok(renderBusinessProfileContext(profile.data));
};

export const buildBusinessProfileContext = (
  db: DbConnection,
  organizationId: string
) =>
  trackedResult(
    'claire.systemPrompt.buildBusinessProfileContext',
    () => buildBusinessProfileContextImpl(db, organizationId),
    {
      properties: { organizationId },
      internalErrorsOnly: true,
    }
  );

export type BuildBusinessProfileContextResult = Awaited<
  ReturnType<typeof buildBusinessProfileContext>
>;

/**
 * Pure-function variant — callers that already have a profile in hand
 * can render directly without a DB hit. Exposed for tests and for the
 * orchestrator builder if it ever needs to fold this into Block 3.
 *
 * FOLLOW-UP: this still reads the CACHED `profile.rankedServices` rather than
 * the live ranking (recomputeRanking). The prompt builder doesn't have the
 * org's services list in hand and we deliberately don't force a services fetch
 * into it. It's a soft surface (system-prompt summary text, regenerated on
 * conversation open), and the live recommendation tools — which DO recompute —
 * are the source of truth the model actually acts on. Switch this to live if
 * the prompt builder ever gains cheap access to the services list.
 */
export const renderBusinessProfileContext = (
  profile: BusinessProfile
): string => {
  const lines: string[] = [
    '## Business profile (Claire-engine classification)',
    `- Retention model: ${profile.retentionModel}`,
    `- Commitment level: ${profile.commitmentLevel}`,
    `- Market position: ${profile.marketPosition}`,
  ];

  const ranked = (profile.rankedServices ?? [])
    .slice()
    .sort((a, b) => a.rank - b.rank);

  if (ranked.length === 0) {
    lines.push(
      '',
      'No ranked services yet — classification is still in progress. ' +
        'Do NOT recommend a specific service until ranked services appear.'
    );
    return lines.join('\n');
  }

  lines.push(
    '',
    `Top ${Math.min(MAX_RANKED_LINES, ranked.length)} services to advertise (in priority order):`
  );
  ranked.slice(0, MAX_RANKED_LINES).forEach((r, i) => {
    lines.push(
      `${i + 1}. ${r.serviceRecommendationCopy.title} — ${r.serviceRecommendationCopy.body}`
    );
  });

  const top = ranked[0];
  if (!top) {
    return lines.join('\n');
  }
  lines.push(
    '',
    `Offer strategy for top pick: ${top.offerStrategy}`,
    `Reasoning: ${top.offerStrategyReason}`
  );
  if (typeof top.suggestedIntroPrice === 'number') {
    lines.push(`Suggested intro price: €${top.suggestedIntroPrice}`);
  }

  lines.push(
    '',
    'When the user mentions ads, marketing, offers, or campaigns, use the recommendation tools.',
    'Push the top pick at most ONCE per ad/offer creation cycle, then defer to the user choice.',
    'The owner is the source of truth for their business — your job is to advise, not to insist.'
  );

  if (top.objections.length > 0) {
    lines.push('', 'Common objection handlers (for the top pick):');
    for (const o of top.objections.slice(0, MAX_OBJECTION_LINES)) {
      lines.push(`- ${o.trigger}: ${o.response}`);
    }
  }

  return lines.join('\n');
};
