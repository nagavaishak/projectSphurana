import { lead, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetLeadStatsInput,
  getLeadStatsSchema,
} from './get-lead-stats.schema.js';

const getLeadStatsImpl = async (db: DbConnection, input: GetLeadStatsInput) => {
  const parsed = getLeadStatsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const rows = await db
    .select({
      status: lead.status,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(lead)
    .where(and(eq(lead.organizationId, organizationId), notDeleted(lead)))
    .groupBy(lead.status);

  const countMap = new Map(rows.map((r) => [r.status, r.count]));
  const totalLeads = rows.reduce((sum, r) => sum + r.count, 0);
  const bookedLeads = countMap.get('booked') ?? 0;

  return ok({
    totalLeads,
    newLeads: countMap.get('new') ?? 0,
    contactedLeads: countMap.get('contacted') ?? 0,
    bookedLeads,
    lostLeads: countMap.get('lost') ?? 0,
    conversionRate:
      totalLeads > 0 ? Math.round((bookedLeads / totalLeads) * 1000) / 10 : 0,
  });
};

export const getLeadStats = (db: DbConnection, input: GetLeadStatsInput) =>
  trackedResult(
    'leads.getLeadStats',
    () => withOrgScope((tx) => getLeadStatsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetLeadStatsResult = Awaited<ReturnType<typeof getLeadStats>>;
