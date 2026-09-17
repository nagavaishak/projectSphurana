import {
  type Disagreement,
  businessProfile,
} from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import { trackDisagreementIgnoredAuto } from '../../telemetry/index.js';

/**
 * Auto-ignore stale classifier disagreements.
 *
 * A disagreement is `pending` after the classifier emits it. The widget +
 * chat both prompt the operator to resolve it on next interaction; many
 * orgs will simply never visit `/ads/new` or open chat. After
 * `DISAGREEMENT_AUTO_IGNORE_DAYS` (default 30), this sweep marks them
 * `ignored` so the classifier funnel reflects reality.
 *
 * Resolution criteria:
 *   - `disagreement.resolution === 'pending'`
 *   - `disagreement.surfacedAt` is set AND older than the cutoff
 *
 * If `surfacedAt` is null (never surfaced — operator never saw it), we
 * leave the row alone. Those will surface eventually; only **surfaced
 * + still pending** rows count as "operator saw it and did nothing".
 *
 * Emits `claire.disagreement.ignored_auto` per row swept.
 */
export const DISAGREEMENT_AUTO_IGNORE_DAYS = 30;

export interface AutoIgnoreDisagreementsResult {
  swept: number;
  failed: number;
}

export const runAutoIgnoreDisagreementsTrigger = async (
  db: DbConnection
): Promise<
  | { success: true; data: AutoIgnoreDisagreementsResult }
  | { success: false; error: { code: string; message: string } }
> => {
  try {
    const cutoff = new Date(
      Date.now() - DISAGREEMENT_AUTO_IGNORE_DAYS * 24 * 60 * 60 * 1000
    );

    // Pull all surfaced + pending disagreements. Filter in app code because
    // `disagreement` is a jsonb blob and date comparison inside JSON requires
    // postgres-specific casting that's not worth the maintenance burden for
    // a daily sweep over hundreds of rows.
    const candidates = await db.query.businessProfile.findMany({
      where: and(
        isNotNull(businessProfile.disagreement),
        // `->>` blows up if disagreement is a non-object JSONB value
        // (string, number, array) — a row has drifted in prod. Guard with
        // jsonb_typeof so the cast below is safe.
        sql`jsonb_typeof(${businessProfile.disagreement}) = 'object'`,
        sql`(${businessProfile.disagreement}->>'resolution') = 'pending'`,
        sql`(${businessProfile.disagreement}->>'surfaced')::boolean = true`
      ),
      columns: {
        id: true,
        organizationId: true,
        disagreement: true,
        overriddenAxes: true,
        classifierAxes: true,
      },
    });

    let swept = 0;
    let failed = 0;

    for (const row of candidates) {
      const d: Disagreement | null = row.disagreement;
      if (!d || d.resolution !== 'pending') continue;
      if (!d.surfacedAt) continue;
      const surfacedAt = new Date(d.surfacedAt);
      if (Number.isNaN(surfacedAt.getTime())) continue;
      if (surfacedAt > cutoff) continue;

      try {
        await db
          .update(businessProfile)
          .set({
            disagreement: {
              ...d,
              resolution: 'ignored',
            } satisfies Disagreement,
          })
          .where(eq(businessProfile.id, row.id));

        const daysSinceSurfaced = Math.floor(
          (Date.now() - surfacedAt.getTime()) / (24 * 60 * 60 * 1000)
        );
        trackDisagreementIgnoredAuto(row.organizationId, {
          surface: 'ads_new',
          axes: d.axes,
          classifierConfidence: d.classifierConfidence,
          ownerOverride: row.overriddenAxes
            ? {
                retentionModel: row.overriddenAxes.retentionModel,
                commitmentLevel: row.overriddenAxes.commitmentLevel,
                marketPosition: row.overriddenAxes.marketPosition,
              }
            : undefined,
          classifierProposal: row.classifierAxes
            ? {
                retentionModel: row.classifierAxes.retentionModel,
                commitmentLevel: row.classifierAxes.commitmentLevel,
                marketPosition: row.classifierAxes.marketPosition,
              }
            : undefined,
          daysSinceSurfaced,
        });
        swept += 1;
      } catch (error) {
        failed += 1;
        logError('claire.autoIgnoreDisagreements.row', error, {
          feature: 'claire',
          extra: { organizationId: row.organizationId },
        });
      }
    }

    return { success: true, data: { swept, failed } };
  } catch (error) {
    logError('claire.autoIgnoreDisagreements', error, { feature: 'claire' });
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to sweep disagreements',
      },
    };
  }
};
