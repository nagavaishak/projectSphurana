import { getMetaIntegrationResponseSchema } from '@borradh-workspace/contracts';
import {
  type Currency,
  currencyForCode,
  currencyMinorUnitDigits,
} from '@borradh-workspace/features/shared';
import type { ApiFetchFn } from '../../tool-factory/api-fetch.js';

/**
 * Resolve the display currency for an ISO code in the AD BUDGET path.
 *
 * Budgets flow through Meta as the currency's minor unit, and every budget/price
 * tool here multiplies whole units by 100 (cents) — which is ONLY correct for
 * 2-decimal currencies. So a null/unknown code, or a zero-/3-decimal currency
 * (JPY, KRW, BHD…), falls back to EUR with `supported: false`, rather than
 * sending Meta a 100×-wrong budget. This keeps the ENG-626 "2-decimal only"
 * scope honest; broader minor-unit support is a separate, deliberate change.
 *
 * The `^[A-Z]{3}$` gate is also a safety boundary: this value is interpolated
 * into Claire's system prompt, so anything that isn't a plain ISO code (it
 * always is — Meta sets it — but defence in depth) can never reach the prompt.
 */
export function adAccountCurrency(code: string | null | undefined): {
  currency: Currency;
  supported: boolean;
} {
  const trimmed = code?.trim().toUpperCase();
  if (
    !trimmed ||
    !/^[A-Z]{3}$/.test(trimmed) ||
    currencyMinorUnitDigits(trimmed) !== 2
  ) {
    return { currency: currencyForCode('EUR'), supported: false };
  }
  return { currency: currencyForCode(trimmed), supported: true };
}

/**
 * The subset of a Meta integration page this resolver needs.
 */
export interface AdCurrencyPage {
  id: string;
  isActive: boolean;
  defaultAdAccountCurrency?: string | null;
}

/**
 * Pick the page whose ad-account currency governs, and resolve it.
 *
 * ACTIVE pages only, then the org's `defaultPageId` if it is one of them,
 * otherwise the first active page. Both the budget/price tools (via
 * `resolveAdAccountCurrency`) and the Claire system prompt (`plan-chat-turn`)
 * call THIS function rather than re-deriving the rule, so the conversational
 * prose and the tool cards cannot select different pages — a stale
 * `defaultPageId` pointing at a deactivated page used to make them disagree.
 */
export function adAccountCurrencyForPages(
  pages: readonly AdCurrencyPage[] | null | undefined,
  defaultPageId: string | null | undefined
): { currency: Currency; supported: boolean } {
  const activePages = (pages ?? []).filter((p) => p.isActive);
  const defaultPage =
    activePages.find((p) => p.id === defaultPageId) ?? activePages[0];
  return adAccountCurrency(defaultPage?.defaultAdAccountCurrency);
}

/**
 * Resolve the currency Claire should reason and format ad budgets/prices in.
 *
 * Per the currency spec (ENG-626): the connected Meta ad account's currency is
 * the ONLY source of truth — it's what Meta actually bills in — so we never
 * infer it from the org's country or trust a model-supplied guess. When no ad
 * account is connected yet, we fall back to EUR and flag `resolved: false` so
 * the caller can SURFACE that assumption to the user ("assuming EUR — connect
 * your Meta ad account to lock the real currency") rather than silently commit.
 *
 * Because every ad budget/price surface derives its symbol/formatting from this
 * one resolved value, a currency mismatch is impossible by construction (there
 * is no separate code path that could disagree).
 *
 * Scope is 2-decimal currencies (see `adAccountCurrency`); a zero-/3-decimal
 * account currency also degrades to the EUR fallback so the ×100 budget math
 * stays correct.
 */
export interface ResolvedAdCurrency {
  currency: Currency;
  /** true when taken from a connected ad account; false when EUR fallback. */
  resolved: boolean;
}

const EUR_FALLBACK: ResolvedAdCurrency = {
  currency: currencyForCode('EUR'),
  resolved: false,
};

/**
 * Fetches the org's Meta integration and returns the default page's ad-account
 * currency. Any failure (no integration, not configured, no active page, Graph
 * error) degrades to the EUR fallback — resolving currency must never break a
 * budget/price tool call.
 */
export async function resolveAdAccountCurrency(ctx: {
  apiFetch: ApiFetchFn;
}): Promise<ResolvedAdCurrency> {
  try {
    const { integration } = await ctx.apiFetch(
      'integrations/meta-ads/integration',
      { schema: getMetaIntegrationResponseSchema }
    );
    if (!integration) return EUR_FALLBACK;

    const { currency, supported } = adAccountCurrencyForPages(
      integration.pages,
      integration.defaultPageId
    );
    return { currency, resolved: supported };
  } catch {
    return EUR_FALLBACK;
  }
}
