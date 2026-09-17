import {
  type CampaignTroubleshootAttempt,
  type CampaignTroubleshootState,
  campaignTroubleshootState,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AdvanceTroubleshootStateInput,
  advanceTroubleshootStateSchema,
} from './advance-troubleshoot-state.schema.js';

/**
 * Advance the troubleshoot lifecycle for a campaign (PRD-1 Task 2).
 *
 * Upsert semantics: creates the row on first touch (round `none`), then
 * applies the requested transition. Round only ever moves forward —
 * `offer_adjusted` then `creative_refreshed` — and `escalate` is idempotent
 * (a second escalate keeps the original `escalatedAt`). The attempt trails
 * (`offersTried` / `creativesTried`) are append-only so an escalation hand-off
 * can show everything that was tried.
 */
const advanceTroubleshootStateImpl = async (
  db: DbConnection,
  input: AdvanceTroubleshootStateInput
): Promise<Result<CampaignTroubleshootState>> => {
  const parsed = advanceTroubleshootStateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaCampaignId, action, note, ref } = parsed.data;
  const now = new Date();

  try {
    const existing = await db.query.campaignTroubleshootState.findFirst({
      where: and(
        eq(campaignTroubleshootState.organizationId, organizationId),
        eq(campaignTroubleshootState.metaCampaignId, metaCampaignId)
      ),
    });

    const attempt: CampaignTroubleshootAttempt | null = note
      ? { note, at: now.toISOString(), ...(ref ? { ref } : {}) }
      : null;

    const base: CampaignTroubleshootState = existing ?? {
      id: '',
      organizationId,
      metaCampaignId,
      currentRound: 'none',
      offersTried: [],
      creativesTried: [],
      escalatedAt: null,
      lastDiagnosedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const next = {
      currentRound: base.currentRound,
      offersTried: [...base.offersTried],
      creativesTried: [...base.creativesTried],
      escalatedAt: base.escalatedAt,
      lastDiagnosedAt: base.lastDiagnosedAt,
    };

    switch (action) {
      case 'mark_diagnosed':
        next.lastDiagnosedAt = now;
        break;
      case 'offer_adjusted':
        next.currentRound = 'offer_adjusted';
        if (attempt) next.offersTried.push(attempt);
        break;
      case 'creative_refreshed':
        next.currentRound = 'creative_refreshed';
        if (attempt) next.creativesTried.push(attempt);
        break;
      case 'escalate':
        // Idempotent: keep the first escalation timestamp.
        next.escalatedAt = base.escalatedAt ?? now;
        break;
    }

    if (existing) {
      const [updated] = await db
        .update(campaignTroubleshootState)
        .set({
          currentRound: next.currentRound,
          offersTried: next.offersTried,
          creativesTried: next.creativesTried,
          escalatedAt: next.escalatedAt,
          lastDiagnosedAt: next.lastDiagnosedAt,
          updatedAt: now,
        })
        .where(eq(campaignTroubleshootState.id, existing.id))
        .returning();
      return ok(updated);
    }

    const [inserted] = await db
      .insert(campaignTroubleshootState)
      .values({
        organizationId,
        metaCampaignId,
        currentRound: next.currentRound,
        offersTried: next.offersTried,
        creativesTried: next.creativesTried,
        escalatedAt: next.escalatedAt,
        lastDiagnosedAt: next.lastDiagnosedAt,
      })
      .returning();
    return ok(inserted);
  } catch {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to advance campaign troubleshoot state'
      )
    );
  }
};

export const advanceTroubleshootState = (
  db: DbConnection,
  input: AdvanceTroubleshootStateInput
) =>
  trackedResult(
    'metaCampaigns.advanceTroubleshootState',
    () => advanceTroubleshootStateImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
        action: input.action,
      },
    }
  );

export type AdvanceTroubleshootStateResult = Awaited<
  ReturnType<typeof advanceTroubleshootState>
>;
