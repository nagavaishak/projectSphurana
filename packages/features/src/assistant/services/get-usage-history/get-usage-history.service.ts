import { withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetUsageHistoryInput,
  getUsageHistorySchema,
} from './get-usage-history.schema.js';

export interface UsageHistoryDay {
  date: string;
  count: number;
}

export interface UsageHistoryMonth {
  month: string;
  count: number;
}

export interface UsageHistoryTool {
  toolName: string;
  count: number;
}

export interface AssistantUsageHistory {
  daily: UsageHistoryDay[];
  monthly: UsageHistoryMonth[];
  topTools: UsageHistoryTool[];
}

const pad2 = (n: number) => n.toString().padStart(2, '0');

const formatDate = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;

const formatMonth = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;

export const buildDailySeries = (
  rows: Array<{ date: string; count: number }>,
  endDate: Date,
  days: number
): UsageHistoryDay[] => {
  const byDate = new Map(rows.map((r) => [r.date, r.count]));
  const series: UsageHistoryDay[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const d = new Date(
      Date.UTC(
        endDate.getUTCFullYear(),
        endDate.getUTCMonth(),
        endDate.getUTCDate() - offset
      )
    );
    const key = formatDate(d);
    series.push({ date: key, count: byDate.get(key) ?? 0 });
  }
  return series;
};

export const buildMonthlySeries = (
  rows: Array<{ month: string; count: number }>,
  endDate: Date,
  months: number
): UsageHistoryMonth[] => {
  const byMonth = new Map(rows.map((r) => [r.month, r.count]));
  const series: UsageHistoryMonth[] = [];
  for (let offset = months - 1; offset >= 0; offset--) {
    const d = new Date(
      Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - offset, 1)
    );
    const key = formatMonth(d);
    series.push({ month: key, count: byMonth.get(key) ?? 0 });
  }
  return series;
};

const getUsageHistoryImpl = async (
  db: DbConnection,
  input: GetUsageHistoryInput
): Promise<Result<AssistantUsageHistory>> => {
  const parsed = getUsageHistorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, days, monthlyMonths } = parsed.data;

  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );

  const dailyStart = new Date(
    Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth(),
      todayUtc.getUTCDate() - (days - 1)
    )
  );

  const monthlyStart = new Date(
    Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth() - (monthlyMonths - 1),
      1
    )
  );

  const dailyStartStr = formatDate(dailyStart);
  const monthlyStartStr = formatDate(monthlyStart);

  try {
    const [dailyRows, monthlyRows] = await withOrgScope(
      (tx) =>
        Promise.all([
          tx.execute<{ date: string; count: number }>(sql`
          SELECT
            to_char(date, 'YYYY-MM-DD') AS date,
            message_count::int AS count
          FROM assistant_usage
          WHERE organization_id = ${organizationId}
            AND date >= ${dailyStartStr}
          ORDER BY date ASC
        `),
          tx.execute<{ month: string; count: number }>(sql`
          SELECT
            to_char(date_trunc('month', date), 'YYYY-MM') AS month,
            COALESCE(SUM(message_count), 0)::int AS count
          FROM assistant_usage
          WHERE organization_id = ${organizationId}
            AND date >= ${monthlyStartStr}
          GROUP BY 1
          ORDER BY 1 ASC
        `),
        ]),
      { db }
    );

    const daily = buildDailySeries(
      dailyRows.map((r) => ({ date: r.date, count: r.count })),
      todayUtc,
      days
    );
    const monthly = buildMonthlySeries(
      monthlyRows.map((r) => ({ month: r.month, count: r.count })),
      todayUtc,
      monthlyMonths
    );

    // Top-tools deferred per W-C17-usage-dashboard brief: tool-call counts
    // are tracked via PostHog `claire.tool_called` events; querying PostHog
    // from the backend is not in v3 scope and a new DB tracking layer is
    // out of bounds without composer authorization.
    const topTools: UsageHistoryTool[] = [];

    return ok({ daily, monthly, topTools });
  } catch (error) {
    logError('assistant.getUsageHistory', error, {
      feature: 'assistant',
      extra: { organizationId, days, monthlyMonths },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve usage history'
      )
    );
  }
};

export const getAssistantUsageHistory = (
  db: DbConnection,
  input: GetUsageHistoryInput
) =>
  trackedResult(
    'assistant.getUsageHistory',
    () => getUsageHistoryImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
