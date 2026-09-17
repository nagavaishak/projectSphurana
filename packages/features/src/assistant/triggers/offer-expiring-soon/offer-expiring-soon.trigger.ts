import {
  type AssistantRecommendation,
  and,
  assistantRecommendation,
  eq,
  gt,
  sql,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { CreateRecommendationInput } from '../../services/create-recommendation/index.js';
import { generateRecommendationPayload } from '../../services/generate-recommendation-payload/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `offer_expiring_soon`
 * Fires daily. For each org with one or more active offers expiring within
 * the next 7 days, surfaces a single roll-up recommendation ("Offers
 * expiring this week") rather than one rec per offer — per the brief's
 * recommendation, this keeps the inbox clean even for clinics running
 * several promotions at once.
 *
 * Dedupe is two-layered:
 *   1. The standard `_shared.createIfNotActive` skips orgs with an existing
 *      active rec of this kind (prevents double-firing on consecutive cron
 *      runs while a rec is still active).
 *   2. An explicit "no rec of this kind in the last 3 days regardless of
 *      state" check inside this trigger (per the brief's "once every 3 days
 *      max" gotcha — a dismissed rec re-firing the next day is noisy).
 *
 * `primary_action.type: 'navigate'` to `/assistant?prefill=…` so the
 * operator lands in a chat seeded with the relevant question rather than
 * an offers list page they'd have to interpret on their own.
 */
const DEDUPE_WINDOW_DAYS = 3;
const EXPIRY_HORIZON_DAYS = 7;

interface OrgWithExpiringOffers {
  organizationId: string;
  expiringCount: number;
  soonestValidUntil: Date;
}

const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // Pull orgs that have at least one active offer with a valid_until inside
  // the 7-day horizon. We let SQL aggregate so a 1000-org tenant doesn't
  // fan out into 1000 round-trips.
  // NB: the `offer` table has no boolean `is_active` column — an offer's
  // lifecycle lives in the `state` enum (draft/active/paused/expired). The
  // previous `o.is_active = true` predicate referenced a non-existent column
  // and made postgres throw `column o.is_active does not exist` on every run.
  const rows = await db.execute(sql<OrgWithExpiringOffers[]>`
    SELECT
      o.organization_id AS "organizationId",
      COUNT(*) AS "expiringCount",
      MIN(o.valid_until) AS "soonestValidUntil"
    FROM offer o
    WHERE o.state = 'active'
      AND o.valid_until IS NOT NULL
      AND o.valid_until > NOW()
      AND o.valid_until <= NOW() + INTERVAL '7 days'
    GROUP BY o.organization_id
  `);

  const orgRows = (rows as unknown as OrgWithExpiringOffers[]) ?? [];

  const inputs: CreateRecommendationInput[] = [];
  for (const row of orgRows) {
    // 3-day cross-state dedupe. The default per-(org, kind) active-state
    // dedupe in `_shared.createIfNotActive` doesn't catch the "user
    // dismissed yesterday → trigger fires again today" case.
    const recentlyAlerted = await wasAlertedWithinDays(
      db,
      row.organizationId,
      DEDUPE_WINDOW_DAYS
    );
    if (!recentlyAlerted.success) {
      // If the dedupe lookup fails, skip this org rather than fall through
      // to a duplicate write — the next run will re-evaluate.
      continue;
    }
    if (recentlyAlerted.data) continue;

    const generated = await generateRecommendationPayload(db, {
      organizationId: row.organizationId,
      kind: 'offer_expiring_soon',
    });
    if (!generated.success) continue;

    inputs.push({
      organizationId: row.organizationId,
      kind: 'offer_expiring_soon',
      title: generated.data.title,
      body: generated.data.body,
      metadata: {
        expiringCount: Number(row.expiringCount),
        soonestValidUntil: row.soonestValidUntil,
        horizonDays: EXPIRY_HORIZON_DAYS,
      },
      primaryAction: {
        label: 'Open Claire',
        type: 'navigate',
        target:
          '/assistant?prefill=Help me decide whether to extend my offers expiring this week',
      },
    });
  }

  return runOrgLoop(db, inputs);
};

/**
 * Returns ok(true) if a recommendation of kind=offer_expiring_soon was
 * created for this org within the last `days` days, regardless of state.
 * Used to suppress re-triggering after a dismissal.
 */
async function wasAlertedWithinDays(
  db: DbConnection,
  organizationId: string,
  days: number
): Promise<Result<boolean>> {
  try {
    const rows: AssistantRecommendation[] = await db
      .select()
      .from(assistantRecommendation)
      .where(
        and(
          eq(assistantRecommendation.organizationId, organizationId),
          eq(assistantRecommendation.kind, 'offer_expiring_soon'),
          gt(
            assistantRecommendation.createdAt,
            sql`NOW() - (${days} || ' days')::interval`
          )
        )
      )
      .limit(1);
    return ok(rows.length > 0);
  } catch (error) {
    logError('assistant.triggers.offerExpiringSoon.dedupeLookup', error, {
      feature: 'assistant',
      extra: { organizationId, days },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to look up recent offer_expiring_soon recommendations'
      )
    );
  }
}

export const runOfferExpiringSoonTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.offerExpiringSoon', () => runImpl(db));
