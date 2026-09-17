import { metaCampaignConfig, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  currencyForCode,
  err,
  getOrgCurrency,
  ok,
} from '../../../shared/index.js';
import {
  type GetCampaignCurrencyInput,
  getCampaignCurrencySchema,
} from './get-campaign-currency.schema.js';

/**
 * The currency a campaign's budget is denominated in — ALWAYS resolved to a
 * concrete code and symbol, never null.
 *
 * Two sources, in priority order:
 *
 *  1. `campaign` — the ad-account currency snapshotted on the
 *     `meta_campaign_config` row when Borradh created the campaign. This is
 *     authoritative: it's the account that actually gets billed.
 *  2. `organization` — the org's own country, via `currencyForCountry` (the
 *     same signal billing and sales use). Reached when the config row predates
 *     the `adAccountCurrency` column, or when there is NO config row at all
 *     because the campaign was made outside Borradh — `listCampaigns` returns
 *     every campaign on the connected ad account and left-joins config, so
 *     those are addressable and must still render a budget.
 *
 * Resolving here rather than at the call site is deliberate: the previous
 * shape returned `currencyCode: string | null` and left the caller to pick a
 * default, which meant a hardcoded EUR — a US org reading "€15.00/day" over a
 * campaign really spending $15/day. A true number wearing the wrong symbol is
 * register #82 in miniature, so the fallback lives with the data that decides
 * it and no consumer gets to invent one.
 */
export interface CampaignCurrency {
  metaCampaignId: string;
  organizationId: string;
  /** ISO-4217 code, e.g. `'USD'`. */
  currencyCode: string;
  /** Display symbol for that code, e.g. `'$'`. */
  currencySymbol: string;
  source: 'campaign' | 'organization';
}

const getCampaignCurrencyImpl = async (
  db: DbConnection,
  input: GetCampaignCurrencyInput
): Promise<Result<CampaignCurrency>> => {
  const parsed = getCampaignCurrencySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaCampaignId } = parsed.data;

  const config = await db.query.metaCampaignConfig.findFirst({
    where: and(
      eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
      eq(metaCampaignConfig.organizationId, organizationId)
    ),
    columns: {
      metaCampaignId: true,
      organizationId: true,
      adAccountCurrency: true,
    },
  });

  if (config?.adAccountCurrency) {
    const currency = currencyForCode(config.adAccountCurrency);
    return ok({
      metaCampaignId: config.metaCampaignId,
      organizationId: config.organizationId,
      currencyCode: currency.code,
      currencySymbol: currency.symbol,
      source: 'campaign',
    });
  }

  // No stored ad-account currency (older row, or no config row at all because
  // the campaign wasn't created by Borradh). Fall back to the org's country —
  // never to a blanket euro. A missing config row is NOT an error here: those
  // campaigns are listed and editable, and they still need a budget on screen.
  const currency = await getOrgCurrency(db, organizationId);
  return ok({
    metaCampaignId,
    organizationId,
    currencyCode: currency.code,
    currencySymbol: currency.symbol,
    source: 'organization',
  });
};

/**
 * Read the currency a Meta campaign's budget is denominated in. Org-scoped.
 */
export const getCampaignCurrency = (
  db: DbConnection,
  input: GetCampaignCurrencyInput
) =>
  trackedResult(
    'metaCampaigns.getCampaignCurrency',
    () => withOrgScope((tx) => getCampaignCurrencyImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetCampaignCurrencyResult = Awaited<
  ReturnType<typeof getCampaignCurrency>
>;
