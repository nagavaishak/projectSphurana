import { conversation } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, count, eq, gte } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetOrganizationConversationStatsInput,
  getOrganizationConversationStatsSchema,
} from './get-organization-conversation-stats.schema.js';

export interface OrganizationConversationStats {
  /** Conversations created since the start of the current UTC day. */
  today: number;
  /** Conversations created in the last 7 days. */
  last7Days: number;
  /** All-time conversation count for the org. */
  total: number;
}

const getOrganizationConversationStatsImpl = async (
  db: DbConnection,
  input: GetOrganizationConversationStatsInput
): Promise<Result<OrganizationConversationStats>> => {
  const parsed = getOrganizationConversationStatsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const orgCondition = eq(conversation.organizationId, organizationId);

  const [totalRow] = await db
    .select({ value: count() })
    .from(conversation)
    .where(orgCondition);

  const [todayRow] = await db
    .select({ value: count() })
    .from(conversation)
    .where(and(orgCondition, gte(conversation.createdAt, startOfToday)));

  const [weekRow] = await db
    .select({ value: count() })
    .from(conversation)
    .where(and(orgCondition, gte(conversation.createdAt, sevenDaysAgo)));

  return ok({
    today: todayRow?.value ?? 0,
    last7Days: weekRow?.value ?? 0,
    total: totalRow?.value ?? 0,
  });
};

export const getOrganizationConversationStats = (
  db: DbConnection,
  input: GetOrganizationConversationStatsInput
) =>
  trackedResult(
    'adminTerminal.getOrganizationConversationStats',
    () => getOrganizationConversationStatsImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type GetOrganizationConversationStatsResult = Awaited<
  ReturnType<typeof getOrganizationConversationStats>
>;
