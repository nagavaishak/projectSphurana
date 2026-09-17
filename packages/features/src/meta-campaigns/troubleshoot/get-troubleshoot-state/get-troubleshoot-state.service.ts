import {
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
  type GetTroubleshootStateInput,
  getTroubleshootStateSchema,
} from './get-troubleshoot-state.schema.js';

/**
 * Read the troubleshoot lifecycle row for a campaign (PRD-1 Task 2).
 *
 * Returns `null` (NOT a NOT_FOUND error) when no row exists yet — a campaign
 * that has never been diagnosed is simply at round `none`. Callers treat a
 * null as "nothing tried, not escalated".
 */
const getTroubleshootStateImpl = async (
  db: DbConnection,
  input: GetTroubleshootStateInput
): Promise<Result<CampaignTroubleshootState | null>> => {
  const parsed = getTroubleshootStateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const row = await db.query.campaignTroubleshootState.findFirst({
      where: and(
        eq(
          campaignTroubleshootState.organizationId,
          parsed.data.organizationId
        ),
        eq(campaignTroubleshootState.metaCampaignId, parsed.data.metaCampaignId)
      ),
    });

    return ok(row ?? null);
  } catch {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to read campaign troubleshoot state'
      )
    );
  }
};

export const getTroubleshootState = (
  db: DbConnection,
  input: GetTroubleshootStateInput
) =>
  trackedResult(
    'metaCampaigns.getTroubleshootState',
    () => getTroubleshootStateImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetTroubleshootStateResult = Awaited<
  ReturnType<typeof getTroubleshootState>
>;
