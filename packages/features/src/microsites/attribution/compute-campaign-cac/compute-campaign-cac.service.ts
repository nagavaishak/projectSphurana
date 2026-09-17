/**
 * Cost per acquisition, per campaign, from OUR OWN data (plan §11).
 *
 * THE JOIN: `lead.utm_campaign` → `meta_campaign_daily_insights.meta_campaign_id`.
 * Both sides are the Meta campaign ID, which is why `utm_campaign` carries the
 * id and not the display name (see `attribution/utm.ts`) — a rename would
 * otherwise orphan every lead booked before it, and CAC would silently improve.
 *
 * THE JOIN IS HOST-FREE, and that is the point. Nothing here reads a hostname.
 * A tenant moving `salon.borradh.io → salon.com` keeps every lead, every
 * campaign id and every spend row; their CAC series does not break at the move.
 * The regression test for this asserts exactly that.
 *
 * WHY LOCAL SPEND AND NOT A META CALL: `meta_campaign_daily_insights` is
 * already synced daily. Reading it means this endpoint answers with the ad
 * account rate-limited, the token expired, or Meta down — "what did this
 * campaign cost us" must not be a question we can only ask Meta.
 *
 * `metaReportedLeads` is kept alongside `attributedLeads` on purpose. They
 * measure different things (Meta's pixel/lead-form count vs leads that actually
 * reached our database) and the DIVERGENCE is the interesting signal: pixel
 * loss, blocked consent, or a broken destination all show up as a gap.
 */

import {
  lead as leadTable,
  metaCampaignDailyInsights,
} from '@borradh-workspace/database';
import {
  logError,
  trackOrgEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ComputeCampaignCacInput,
  computeCampaignCacSchema,
} from './compute-campaign-cac.schema.js';

/** All money is integer cents, matching `meta_campaign_daily_insights`. */
export interface CampaignCac {
  metaCampaignId: string;
  /** Ad-account currency for `spend`. Null when the window has no spend rows. */
  currency: string | null;
  spend: number;
  spendUsd: number;
  impressions: number;
  clicks: number;
  /** Leads in OUR database carrying this campaign's UTM. */
  attributedLeads: number;
  /** What Meta counted, for divergence. */
  metaReportedLeads: number;
  /** `spend / attributedLeads`, cents. Null with zero leads — not Infinity. */
  costPerAcquisition: number | null;
  costPerAcquisitionUsd: number | null;
}

export interface ComputeCampaignCacData {
  dateRange: { since: string; until: string };
  campaigns: CampaignCac[];
  totals: {
    currency: string | null;
    spend: number;
    spendUsd: number;
    attributedLeads: number;
    costPerAcquisition: number | null;
    costPerAcquisitionUsd: number | null;
  };
}

const defaultDateRange = () => {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 30);
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
};

/** Inclusive day bounds in UTC — `until` covers the whole day, not midnight. */
const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999Z`);

const perAcquisition = (spend: number, leads: number): number | null =>
  leads > 0 ? Math.round(spend / leads) : null;

const computeCampaignCacImpl = async (
  db: DbConnection,
  input: ComputeCampaignCacInput
): Promise<Result<ComputeCampaignCacData>> => {
  const parsed = computeCampaignCacSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, micrositeId } = parsed.data;
  const dateRange = parsed.data.dateRange ?? defaultDateRange();
  const since = dayStart(dateRange.since);
  const until = dayEnd(dateRange.until);

  try {
    // Daily rows, aggregated in memory: one org's campaigns over a window is
    // hundreds of rows, and keeping the SQL trivial keeps it portable across
    // the RLS wrapper.
    //
    // `metaAdId IS NULL` selects the CAMPAIGN-level rows only. Ad-level rows
    // are a sum of the same money; counting both would double every spend.
    const spendRows = await db
      .select({
        metaCampaignId: metaCampaignDailyInsights.metaCampaignId,
        currency: metaCampaignDailyInsights.currency,
        spend: metaCampaignDailyInsights.spend,
        spendUsd: metaCampaignDailyInsights.spendUsd,
        impressions: metaCampaignDailyInsights.impressions,
        clicks: metaCampaignDailyInsights.clicks,
        leads: metaCampaignDailyInsights.leads,
      })
      .from(metaCampaignDailyInsights)
      .where(
        and(
          eq(metaCampaignDailyInsights.organizationId, organizationId),
          isNull(metaCampaignDailyInsights.metaAdId),
          gte(metaCampaignDailyInsights.date, since),
          lte(metaCampaignDailyInsights.date, until)
        )
      );

    // The lead side of the join. Only `utm_campaign` is read — no host, so a
    // domain move is invisible here.
    const leadRows = await db.query.lead.findMany({
      columns: { id: true, utmCampaign: true },
      where: and(
        eq(leadTable.organizationId, organizationId),
        isNotNull(leadTable.utmCampaign),
        isNull(leadTable.deletedAt),
        gte(leadTable.createdAt, since),
        lte(leadTable.createdAt, until),
        ...(micrositeId ? [eq(leadTable.micrositeId, micrositeId)] : [])
      ),
    });

    const byCampaign = new Map<string, CampaignCac>();
    const entry = (metaCampaignId: string): CampaignCac => {
      const existing = byCampaign.get(metaCampaignId);
      if (existing) return existing;
      const fresh: CampaignCac = {
        metaCampaignId,
        currency: null,
        spend: 0,
        spendUsd: 0,
        impressions: 0,
        clicks: 0,
        attributedLeads: 0,
        metaReportedLeads: 0,
        costPerAcquisition: null,
        costPerAcquisitionUsd: null,
      };
      byCampaign.set(metaCampaignId, fresh);
      return fresh;
    };

    for (const row of spendRows) {
      const bucket = entry(row.metaCampaignId);
      bucket.currency = bucket.currency ?? row.currency ?? null;
      bucket.spend += row.spend ?? 0;
      bucket.spendUsd += row.spendUsd ?? 0;
      bucket.impressions += row.impressions ?? 0;
      bucket.clicks += row.clicks ?? 0;
      bucket.metaReportedLeads += row.leads ?? 0;
    }

    // A campaign with leads but no synced spend still gets a row: dropping it
    // would hide leads we paid for, which is the failure mode that matters.
    for (const row of leadRows) {
      if (!row.utmCampaign) continue;
      entry(row.utmCampaign).attributedLeads += 1;
    }

    const campaigns = [...byCampaign.values()]
      .map((c) => ({
        ...c,
        costPerAcquisition: perAcquisition(c.spend, c.attributedLeads),
        costPerAcquisitionUsd: perAcquisition(c.spendUsd, c.attributedLeads),
      }))
      .sort((a, b) => b.spend - a.spend);

    const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
    const totalSpendUsd = campaigns.reduce((sum, c) => sum + c.spendUsd, 0);
    const totalLeads = campaigns.reduce((sum, c) => sum + c.attributedLeads, 0);

    const data: ComputeCampaignCacData = {
      dateRange,
      campaigns,
      totals: {
        currency: campaigns.find((c) => c.currency)?.currency ?? null,
        spend: totalSpend,
        spendUsd: totalSpendUsd,
        attributedLeads: totalLeads,
        costPerAcquisition: perAcquisition(totalSpend, totalLeads),
        costPerAcquisitionUsd: perAcquisition(totalSpendUsd, totalLeads),
      },
    };

    // Fire-and-forget: our own CAC series in PostHog, so the number survives
    // without a Meta round trip.
    trackOrgEvent(organizationId, 'microsite_campaign_cac_computed', {
      since: dateRange.since,
      until: dateRange.until,
      campaigns: campaigns.length,
      spendUsd: totalSpendUsd,
      attributedLeads: totalLeads,
      costPerAcquisitionUsd: data.totals.costPerAcquisitionUsd,
    });

    return ok(data);
  } catch (error) {
    logError('microsites.computeCampaignCac', error, {
      feature: 'microsites',
      extra: { organizationId, dateRange },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to compute CAC')
    );
  }
};

export const computeCampaignCac = (
  db: DbConnection,
  input: ComputeCampaignCacInput
) =>
  trackedResult(
    'microsites.computeCampaignCac',
    () => computeCampaignCacImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ComputeCampaignCacResult = Awaited<
  ReturnType<typeof computeCampaignCac>
>;
