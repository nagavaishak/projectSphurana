import { lead, organization, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
  orgDayString,
  zonedWallTimeToUtc,
} from '../../../shared/index.js';
import {
  type SummariseRecentLeadsInput,
  type SummariseRecentLeadsTimeframe,
  summariseRecentLeadsSchema,
} from './summarise-recent-leads.schema.js';

interface TimeframeWindow {
  /** Inclusive lower bound for the current window. */
  currentStart: Date;
  /** Inclusive lower bound for the prior window (currentStart - duration). */
  previousStart: Date;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `'today'` is a CALENDAR day and must be anchored in the BUSINESS's zone.
 * `setHours(0,0,0,0)` used the SERVER's zone (UTC on Fly), so a Californian
 * org asking Claire "how many leads today?" at 4pm local got a window that had
 * already rolled over at 5pm the previous day — 7 hours of leads attributed to
 * the wrong day.
 *
 * `'week'` and `'month'` are deliberately ROLLING durations (last 7 / last 30
 * days from now), not calendar weeks or months, so they have no day boundary
 * and need no zone.
 */
const computeTimeframeWindow = (
  timeframe: SummariseRecentLeadsTimeframe,
  now: Date,
  timeZone: string
): TimeframeWindow => {
  const currentStart = new Date(now);
  switch (timeframe) {
    case 'today':
      currentStart.setTime(
        zonedWallTimeToUtc(orgDayString(timeZone, now), 0, timeZone).getTime()
      );
      break;
    case 'week':
      currentStart.setTime(now.getTime() - 7 * ONE_DAY_MS);
      break;
    case 'month':
      currentStart.setTime(now.getTime() - 30 * ONE_DAY_MS);
      break;
  }
  const duration = now.getTime() - currentStart.getTime();
  const previousStart = new Date(currentStart.getTime() - duration);
  return { currentStart, previousStart };
};

const summariseRecentLeadsImpl = async (
  db: DbConnection,
  input: SummariseRecentLeadsInput
) => {
  const parsed = summariseRecentLeadsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, timeframe, limit } = parsed.data;
  const now = new Date();

  // Only the calendar-day timeframe needs the org's zone; the rolling ones
  // don't, so don't pay for the lookup.
  let timeZone = 'UTC';
  if (timeframe === 'today') {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: { timezone: true },
    });
    timeZone = org?.timezone || 'UTC';
  }

  const { currentStart, previousStart } = computeTimeframeWindow(
    timeframe,
    now,
    timeZone
  );

  // Count leads grouped by status across the current window. Single grouped
  // query so we can derive both totalLeads and the by-status breakdown
  // without two round-trips.
  const currentRows = await db
    .select({
      status: lead.status,
      source: lead.source,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(lead)
    .where(
      and(
        eq(lead.organizationId, organizationId),
        gte(lead.createdAt, currentStart),
        notDeleted(lead)
      )
    )
    .groupBy(lead.status, lead.source);

  // Count leads in the previous window (same duration immediately preceding)
  // for delta comparisons. Single scalar count is enough.
  const [previousCountRow] = await db
    .select({
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(lead)
    .where(
      and(
        eq(lead.organizationId, organizationId),
        gte(lead.createdAt, previousStart),
        lt(lead.createdAt, currentStart),
        notDeleted(lead)
      )
    );

  const totalLeads = currentRows.reduce((sum, r) => sum + r.count, 0);
  const previousLeads = previousCountRow?.count ?? 0;
  const deltaPercent =
    previousLeads === 0
      ? totalLeads > 0
        ? 100
        : 0
      : Math.round(((totalLeads - previousLeads) / previousLeads) * 100);

  const byStatus = aggregateByDimension(currentRows, 'status');
  const bySource = aggregateByDimension(currentRows, 'source');

  // Top recent leads — surface human-recognisable handles for the model to
  // weave into prose. Excludes notes (no PII bleed beyond name/contact, and
  // names are necessary for "who do I have").
  const topLeads = await db.query.lead.findMany({
    where: and(
      eq(lead.organizationId, organizationId),
      gte(lead.createdAt, currentStart),
      notDeleted(lead)
    ),
    orderBy: desc(lead.createdAt),
    limit,
    columns: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      status: true,
      source: true,
      createdAt: true,
    },
  });

  return ok({
    timeframe,
    windowStart: currentStart.toISOString(),
    windowEnd: now.toISOString(),
    totalLeads,
    previousLeads,
    deltaPercent,
    byStatus,
    bySource,
    topLeads,
  });
};

const aggregateByDimension = (
  rows: { status: string; source: string; count: number }[],
  dimension: 'status' | 'source'
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = row[dimension];
    out[key] = (out[key] ?? 0) + row.count;
  }
  return out;
};

/**
 * Summarise recent leads in a structured shape the model can format into prose.
 *
 * Returns counts (total + by-status + by-source), a deltaPercent vs. the
 * preceding equal-duration window, and a `limit` slice of the most-recent
 * leads with name + handle + status + source. Service is deterministic so
 * eval fixtures replay; prose is the model's job.
 */
export const summariseRecentLeads = (
  db: DbConnection,
  input: SummariseRecentLeadsInput
) =>
  trackedResult(
    'leads.summariseRecentLeads',
    () => withOrgScope((tx) => summariseRecentLeadsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        timeframe: input.timeframe,
      },
      internalErrorsOnly: true,
    }
  );

export type SummariseRecentLeadsResult = Awaited<
  ReturnType<typeof summariseRecentLeads>
>;
