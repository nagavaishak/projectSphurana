import {
  metaAdsIntegration,
  metaAdsPage,
  withOrgScope,
} from '@borradh-workspace/database';
import { fetchWithRetry } from '@borradh-workspace/http';
import { decryptCredentials } from '@borradh-workspace/integrations';
import { GRAPH_API_BASE } from '@borradh-workspace/integrations/shared';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type GetPageInsightsInput,
  getPageInsightsSchema,
} from './get-page-insights.schema.js';

export interface DailyInsight {
  date: string;
  views: number;
  engagements: number;
}

export interface PageInsights {
  pageId: string;
  pageName: string;
  dateRange: { since: string; until: string };
  views: number;
  engagements: number;
  totalFollowers: number;
  daily: DailyInsight[];
}

interface MetaCredentials {
  accessToken: string;
}

interface MetaInsightValue {
  value: number;
  end_time: string;
}

interface MetaInsightEntry {
  name: string;
  period: string;
  values: MetaInsightValue[];
}

const getPageInsightsImpl = async (
  db: DbConnection,
  input: GetPageInsightsInput
): Promise<Result<PageInsights>> => {
  const parsed = getPageInsightsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Default date range: last 28 days
  const now = new Date();
  const defaultSince = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const since = parsed.data.since || defaultSince.toISOString().split('T')[0];
  const until = parsed.data.until || now.toISOString().split('T')[0];

  // Get Meta integration and page
  const integration = await db.query.metaAdsIntegration.findFirst({
    where: and(
      eq(metaAdsIntegration.organizationId, organizationId),
      eq(metaAdsIntegration.isActive, true)
    ),
  });

  if (!integration) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'Meta integration not configured. Please connect your Facebook Page first.'
      )
    );
  }

  let page = await db.query.metaAdsPage.findFirst({
    where: and(
      eq(metaAdsPage.metaAdsIntegrationId, integration.id),
      eq(metaAdsPage.id, integration.defaultPageId || '')
    ),
  });

  if (!page) {
    page = await db.query.metaAdsPage.findFirst({
      where: and(
        eq(metaAdsPage.metaAdsIntegrationId, integration.id),
        eq(metaAdsPage.isActive, true)
      ),
    });
  }

  if (!page) {
    return err(
      new FeatureError(ErrorCodes.FORBIDDEN, 'No Facebook Page connected')
    );
  }

  let pageAccessToken: string;
  try {
    const decrypted = decryptCredentials(
      page.pageAccessToken as string
    ) as MetaCredentials;
    pageAccessToken = decrypted.accessToken;
  } catch {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to decrypt Meta credentials'
      )
    );
  }

  try {
    // Fetch insights metrics individually to handle partial deprecation gracefully.
    // Meta has deprecated many page-level insights (page_impressions, page_fans,
    // page_views, page_views_total, page_engaged_users) across multiple waves
    // (Dec 2023, Sep 2024, Nov 2025). We try each metric separately.
    const metricNames = ['page_post_engagements', 'page_daily_follows_unique'];

    const allEntries: MetaInsightEntry[] = [];

    for (const metric of metricNames) {
      const url = `${GRAPH_API_BASE}/${page.pageId}/insights?metric=${metric}&period=day&since=${since}&until=${until}&access_token=${pageAccessToken}`;
      const response = await fetchWithRetry(url);
      if (response.ok) {
        const data = (await response.json()) as { data: MetaInsightEntry[] };
        if (data.data) allEntries.push(...data.data);
      }
      // Silently skip metrics that return errors (deprecated for this page)
    }

    // Fetch followers count and page profile views from page fields
    const pageFieldsUrl = `${GRAPH_API_BASE}/${page.pageId}?fields=followers_count&access_token=${pageAccessToken}`;
    const pageFieldsResponse = await fetchWithRetry(pageFieldsUrl);

    let totalFollowers = 0;
    if (pageFieldsResponse.ok) {
      const pageFieldsData = (await pageFieldsResponse.json()) as {
        followers_count?: number;
      };
      totalFollowers = pageFieldsData.followers_count ?? 0;
    }

    // Parse daily insights
    const engagementsEntry = allEntries.find(
      (d) => d.name === 'page_post_engagements'
    );
    const followsEntry = allEntries.find(
      (d) => d.name === 'page_daily_follows_unique'
    );

    // Build daily breakdown from engagements (primary metric)
    const dailyMap = new Map<string, DailyInsight>();
    for (const entry of engagementsEntry?.values ?? []) {
      const date = entry.end_time.split('T')[0];
      dailyMap.set(date, {
        date,
        views: 0,
        engagements: entry.value,
      });
    }
    // Use daily follows as "views" proxy (new followers per day)
    for (const entry of followsEntry?.values ?? []) {
      const date = entry.end_time.split('T')[0];
      const existing = dailyMap.get(date);
      if (existing) {
        existing.views = entry.value;
      } else {
        dailyMap.set(date, {
          date,
          views: entry.value,
          engagements: 0,
        });
      }
    }

    const daily = Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    // Sum totals
    let totalViews = 0;
    let totalEngagements = 0;
    for (const d of daily) {
      totalViews += d.views;
      totalEngagements += d.engagements;
    }

    return ok({
      pageId: page.pageId,
      pageName: page.pageName ?? page.pageId,
      dateRange: { since, until },
      views: totalViews,
      engagements: totalEngagements,
      totalFollowers,
      daily,
    });
  } catch (error) {
    logError('integrations.getPageInsights', error, {
      feature: 'integrations',
      extra: { organizationId, pageId: page.pageId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to fetch page insights'
      )
    );
  }
};

export const getPageInsights = (
  db: DbConnection,
  input: GetPageInsightsInput
) =>
  trackedResult(
    'integrations.getPageInsights',
    () => withOrgScope((tx) => getPageInsightsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetPageInsightsResult = Awaited<ReturnType<typeof getPageInsights>>;
