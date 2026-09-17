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
import { leadAtBranch } from '../../shared/at-branch.js';
import { derivedLeadStage } from '../lead-stage/index.js';
import {
  type GetLeadStageCountsInput,
  getLeadStageCountsSchema,
} from './get-lead-stage-counts.schema.js';

/**
 * Both the per-stage and the per-tab counts for the Clients surface, from a
 * single grouped query — so the tab badges are one request rather than three
 * list calls. `tabs.all` is every non-deleted lead (including `lost`, which has
 * no tab); the `contacted` tab folds in `qualified` (a contacted lead who
 * replied).
 *
 * Grouped by the DERIVED stage (`derived-stage.ts`), not by a stored column —
 * the counts and the list are the same expression, so a badge can never
 * disagree with the rows behind it.
 */
const getLeadStageCountsImpl = async (
  db: DbConnection,
  input: GetLeadStageCountsInput
) => {
  const parsed = getLeadStageCountsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId } = parsed.data;

  // Branch scoping, via the SAME predicate the list uses (`leadAtBranch`) —
  // this is what keeps a badge and the rows beneath it in agreement. It was
  // missing entirely: the counts filtered by organization alone while the table
  // filtered by branch.
  const conditions = [
    eq(lead.organizationId, organizationId),
    notDeleted(lead),
  ];
  if (locationId) {
    conditions.push(leadAtBranch(db, locationId));
  }

  const rows = await db
    .select({
      status: sql<string>`${derivedLeadStage()}`.as('stage'),
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(lead)
    .where(and(...conditions))
    .groupBy(sql`1`);

  const countMap = new Map(rows.map((r) => [r.status, r.count]));
  const at = (s: string) => countMap.get(s as never) ?? 0;

  const stages = {
    new: at('new'),
    contacted: at('contacted'),
    qualified: at('qualified'),
    booked: at('booked'),
    lost: at('lost'),
  };
  const all = rows.reduce((sum, r) => sum + r.count, 0);

  return ok({
    stages,
    tabs: {
      all,
      leads: stages.new,
      // The Contacted tab covers both contacted and qualified (see
      // `leadStageGroups`), so its badge sums the two.
      contacted: stages.contacted + stages.qualified,
      booked: stages.booked,
    },
  });
};

export const getLeadStageCounts = (
  db: DbConnection,
  input: GetLeadStageCountsInput
) =>
  trackedResult(
    'leads.getLeadStageCounts',
    () => withOrgScope((tx) => getLeadStageCountsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetLeadStageCountsResult = Awaited<
  ReturnType<typeof getLeadStageCounts>
>;
