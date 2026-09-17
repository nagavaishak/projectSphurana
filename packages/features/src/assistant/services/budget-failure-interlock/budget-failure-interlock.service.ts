import {
  and,
  assistantConversation,
  eq,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { sql } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import {
  type BudgetFailureInterlockInput,
  type ResolveBudgetFailureInterlockInput,
  budgetFailureInterlockSchema,
  resolveBudgetFailureInterlockSchema,
} from './budget-failure-interlock.schema.js';

/**
 * Money-truth interlock (register #137): a launch must not proceed at the OLD
 * budget after a budget change for the same campaign failed. We record the
 * failed campaign on the conversation row; the launch tools check it and refuse
 * (`blocked: unacknowledged_budget_failure`) until the owner explicitly says to
 * go ahead anyway.
 *
 * All three helpers are best-effort and fail SAFE for their caller:
 *   - `flag` failing to write is logged but returns ok — better to miss the
 *     interlock than to break a budget-error report.
 *   - `resolve` failing to READ returns `{ blocked: false }` — a transient DB
 *     blip must not permanently wedge every launch in the conversation.
 */

const flagBudgetFailureImpl = async (
  db: DbConnection,
  input: BudgetFailureInterlockInput
): Promise<Result<{ flagged: boolean }>> => {
  const parsed = budgetFailureInterlockSchema.safeParse(input);
  if (!parsed.success) return ok({ flagged: false });

  const { conversationId, organizationId, metaCampaignId } = parsed.data;
  try {
    // Atomic set-union append — same idiom as append-loaded-skill.
    const updated = await withOrgScope(
      (tx) =>
        tx
          .update(assistantConversation)
          .set({
            budgetFailureCampaignIds: sql`array(select distinct unnest(${assistantConversation.budgetFailureCampaignIds} || array[${metaCampaignId}]::text[]))`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(assistantConversation.id, conversationId),
              eq(assistantConversation.organizationId, organizationId)
            )
          )
          .returning({ id: assistantConversation.id }),
      { db }
    );
    return ok({ flagged: updated.length > 0 });
  } catch (error) {
    logError('assistant.flagBudgetFailure', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, metaCampaignId },
    });
    return ok({ flagged: false });
  }
};

const clearBudgetFailureImpl = async (
  db: DbConnection,
  input: BudgetFailureInterlockInput
): Promise<Result<{ cleared: boolean }>> => {
  const parsed = budgetFailureInterlockSchema.safeParse(input);
  if (!parsed.success) return ok({ cleared: false });

  const { conversationId, organizationId, metaCampaignId } = parsed.data;
  try {
    await withOrgScope(
      (tx) =>
        tx
          .update(assistantConversation)
          .set({
            budgetFailureCampaignIds: sql`array(select unnest(${assistantConversation.budgetFailureCampaignIds}) except select ${metaCampaignId})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(assistantConversation.id, conversationId),
              eq(assistantConversation.organizationId, organizationId)
            )
          ),
      { db }
    );
    return ok({ cleared: true });
  } catch (error) {
    logError('assistant.clearBudgetFailure', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, metaCampaignId },
    });
    return ok({ cleared: false });
  }
};

const resolveBudgetFailureInterlockImpl = async (
  db: DbConnection,
  input: ResolveBudgetFailureInterlockInput
): Promise<Result<{ blocked: boolean; cleared: boolean }>> => {
  const parsed = resolveBudgetFailureInterlockSchema.safeParse(input);
  if (!parsed.success) return ok({ blocked: false, cleared: false });

  const { conversationId, organizationId, metaCampaignId, acknowledged } =
    parsed.data;
  try {
    const row = await withOrgScope(
      (tx) =>
        tx.query.assistantConversation.findFirst({
          where: and(
            eq(assistantConversation.id, conversationId),
            eq(assistantConversation.organizationId, organizationId)
          ),
          columns: { budgetFailureCampaignIds: true },
        }),
      { db }
    );

    const flagged =
      row?.budgetFailureCampaignIds?.includes(metaCampaignId) ?? false;
    if (!flagged) return ok({ blocked: false, cleared: false });

    if (acknowledged) {
      await clearBudgetFailureImpl(db, {
        organizationId,
        conversationId,
        metaCampaignId,
      });
      return ok({ blocked: false, cleared: true });
    }

    return ok({ blocked: true, cleared: false });
  } catch (error) {
    logError('assistant.resolveBudgetFailureInterlock', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, metaCampaignId },
    });
    // Fail open for launches — never wedge the conversation on a read blip.
    return ok({ blocked: false, cleared: false });
  }
};

export const flagBudgetFailure = (
  db: DbConnection,
  input: BudgetFailureInterlockInput
) =>
  trackedResult(
    'assistant.flagBudgetFailure',
    () => flagBudgetFailureImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
      internalErrorsOnly: true,
    }
  );

export const clearBudgetFailure = (
  db: DbConnection,
  input: BudgetFailureInterlockInput
) =>
  trackedResult(
    'assistant.clearBudgetFailure',
    () => clearBudgetFailureImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
      internalErrorsOnly: true,
    }
  );

export const resolveBudgetFailureInterlock = (
  db: DbConnection,
  input: ResolveBudgetFailureInterlockInput
) =>
  trackedResult(
    'assistant.resolveBudgetFailureInterlock',
    () => resolveBudgetFailureInterlockImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
      internalErrorsOnly: true,
    }
  );

export type FlagBudgetFailureResult = Awaited<
  ReturnType<typeof flagBudgetFailure>
>;
export type ResolveBudgetFailureInterlockResult = Awaited<
  ReturnType<typeof resolveBudgetFailureInterlock>
>;
