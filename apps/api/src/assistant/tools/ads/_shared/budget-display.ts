import { listMetaCampaignsResponseSchema } from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import { getCampaignCurrency } from '@borradh-workspace/features/meta-campaigns';
import { z } from 'zod';
import type { AssistantToolsContext } from '../../../tool-factory/types.js';

/**
 * `GET /meta-ads/:id` path pattern. The launch tools resolve an ad's parent
 * campaign id through the loopback (rather than importing the meta-ads feature
 * graph into apps/api), so they must add this to their `additionalAllowedPaths`.
 */
export const META_AD_BY_ID_PATH = /^meta-ads\/[a-zA-Z0-9_-]+$/;

/** Minimal projection of `GET /meta-ads/:id` — only the campaign id is read. */
const adCampaignRefSchema = z
  .object({ metaCampaignId: z.string().nullable().optional() })
  .passthrough();

/**
 * SERVER-derived budget display for the ad cards.
 *
 * Register #82: the owner asked for $20/day, the change ran at $15, and every
 * ad card said "$20/day" because `budgetDisplay` was a free-text string the
 * MODEL authored and passed through. The money string must never be the
 * model's word — it must be read back from the campaign that will actually
 * spend. This helper is the single source of that string for `createDraftAd`,
 * `confirmLaunchAd` and `executeLaunchAd` (mirrors the server-derived
 * `formatBudget` in `create-campaign.tool.ts`).
 */

/** `formatDailyBudget(2000, '$')` → `"$20.00/day"`. Cents → major units. */
export function formatDailyBudget(cents: number, symbol: string): string {
  return `${symbol}${(cents / 100).toFixed(2)}/day`;
}

export interface ResolvedBudgetDisplay {
  /** Ready-to-render string (e.g. `"€25.00/day"`), or null when the campaign's
   *  budget could not be read back — the card then omits the money line rather
   *  than showing a guess. */
  budgetDisplay: string | null;
  /** The campaign's daily budget in cents, or null when unknown. */
  dailyBudgetCents: number | null;
}

const EMPTY: ResolvedBudgetDisplay = {
  budgetDisplay: null,
  dailyBudgetCents: null,
};

/**
 * Read the campaign's actual daily budget (live from Meta via
 * `GET /meta-campaigns`) and its ad-account currency (snapshot on the config
 * row), and format the display string. Best-effort: any lookup failure yields
 * `{ budgetDisplay: null }` so the card simply omits the money line — an
 * omitted figure is honest; a wrong figure is the #82 defect.
 */
export async function resolveCampaignBudgetDisplay(
  ctx: Pick<AssistantToolsContext, 'apiFetch'>,
  {
    organizationId,
    metaCampaignId,
  }: { organizationId: string; metaCampaignId: string }
): Promise<ResolvedBudgetDisplay> {
  let dailyBudgetCents: number | null = null;
  try {
    const { campaigns } = await ctx.apiFetch('meta-campaigns', {
      schema: listMetaCampaignsResponseSchema,
    });
    const entry = campaigns.find((c) => c.id === metaCampaignId);
    // `dailyBudget` is Meta's raw minor-unit STRING (e.g. "1500" = 15.00).
    if (entry?.dailyBudget != null) {
      const parsed = Number(entry.dailyBudget);
      if (Number.isFinite(parsed) && parsed > 0) dailyBudgetCents = parsed;
    }
  } catch {
    return EMPTY;
  }

  if (dailyBudgetCents === null) return EMPTY;

  // The symbol is resolved SERVER-SIDE by the feature service: the campaign's
  // own ad-account currency when we stored one, else the org's country. This
  // helper deliberately owns no currency table and no default — a wrong symbol
  // over a true number is the same class of defect as a wrong number (#82), so
  // if the lookup can't answer, the money line is omitted rather than guessed.
  let currencySymbol: string | null = null;
  try {
    const currency = await getCampaignCurrency(db, {
      organizationId,
      metaCampaignId,
    });
    if (currency.success) currencySymbol = currency.data.currencySymbol;
  } catch {
    return EMPTY;
  }

  if (currencySymbol === null) return EMPTY;

  return {
    budgetDisplay: formatDailyBudget(dailyBudgetCents, currencySymbol),
    dailyBudgetCents,
  };
}

/**
 * Resolve an ad's parent `metaCampaignId` via `GET /meta-ads/:id`. Requires
 * {@link META_AD_BY_ID_PATH} in the calling tool's `additionalAllowedPaths`.
 * Returns null on any failure (missing ad, contract drift, network).
 */
export async function resolveAdCampaignId(
  ctx: Pick<AssistantToolsContext, 'apiFetch'>,
  adId: string
): Promise<string | null> {
  try {
    const ad = await ctx.apiFetch(`meta-ads/${adId}`, {
      schema: adCampaignRefSchema,
    });
    return ad.metaCampaignId ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the budget display for an AD (not a campaign): looks up the ad's
 * parent `metaCampaignId` via `GET /meta-ads/:id` then delegates to
 * {@link resolveCampaignBudgetDisplay}. Used by the launch confirm/execute
 * tools, which only carry an `adId`. Requires {@link META_AD_BY_ID_PATH} in
 * the calling tool's `additionalAllowedPaths`. Best-effort: `{ null }` on any
 * failure so the card omits the money line.
 */
export async function resolveAdBudgetDisplay(
  ctx: Pick<AssistantToolsContext, 'apiFetch'>,
  { organizationId, adId }: { organizationId: string; adId: string }
): Promise<ResolvedBudgetDisplay> {
  const metaCampaignId = await resolveAdCampaignId(ctx, adId);
  if (!metaCampaignId) return EMPTY;
  return resolveCampaignBudgetDisplay(ctx, { organizationId, metaCampaignId });
}
