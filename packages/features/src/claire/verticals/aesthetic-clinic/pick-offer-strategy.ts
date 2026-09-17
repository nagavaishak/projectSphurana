import type { OfferStrategyResult, PickOfferStrategyInput } from '../types.js';
import { extractPriceCents, taxonomiseService } from './service-taxonomy.js';

const round = (cents: number): number => Math.round(cents);

// Per-service offer-strategy decision. Note: the `switch_service` cascade and
// `do_not_advertise` fallback live in `compose-recommendation.ts` because they
// need the full ranked list to decide. This function returns the LOCAL
// decision for one service.
export const pickOfferStrategy = (
  input: PickOfferStrategyInput
): OfferStrategyResult => {
  const { axes, ranked, service } = input;
  const entry = taxonomiseService(service);
  const clinicPrice = extractPriceCents(service);

  // 1. POM / cannot-advertise — flag for caller-side switch.
  if (ranked.criteriaScores.complianceRisk >= 1.0 || entry.isPOM) {
    return {
      strategy: 'switch_service',
      reason:
        'POM treatments cannot be advertised. Switch to the next ranked service.',
    };
  }

  // 2. Consideration sale / major commitment → consultation-led, no price.
  if (
    axes.commitmentLevel === 'major' ||
    axes.retentionModel === 'consideration_sale'
  ) {
    return {
      strategy: 'consultation_led',
      reason:
        'Consultation-led — pricing for surgical and major procedures stays off cold-traffic ads. Lead with the consultation.',
    };
  }

  // 3. Market-position branches.
  switch (axes.marketPosition) {
    case 'below':
      return {
        strategy: 'price_visible_intro',
        suggestedIntroPrice:
          clinicPrice !== undefined ? round(clinicPrice * 0.85) : undefined,
        reason:
          "You're already below market — a modest intro discount maximises CAC efficiency without leaving margin on the table.",
      };
    case 'at':
      return {
        strategy: 'price_visible_intro',
        suggestedIntroPrice:
          clinicPrice !== undefined ? round(clinicPrice * 0.7) : undefined,
        reason:
          'Standard intro pricing — CAC should equal or beat first-treatment value. Regular pricing stays the same after the first visit.',
      };
    case 'above':
      // Local default for above-market is Path C (price hidden, qualify in
      // conversation). compose-recommendation.ts handles Path B: if a CHEAPER
      // viable alternative exists downstream in the ranked list, it coerces
      // this to switch_service toward that treatment. With no cheaper
      // alternative, this price_hidden_conversation stays as the final pick.
      return {
        strategy: 'price_hidden_conversation',
        reason:
          'Premium pricing — keep the number off the ad and qualify in conversation. If a cheaper alternative exists in your menu, Claire switches to it instead.',
      };
    case 'unknown':
      return {
        strategy: 'price_hidden_conversation',
        reason:
          "Without market data, hiding price is safer than risking a too-cheap or too-expensive ad. Worth answering Claire's market-position prompt to upgrade this.",
      };
  }
};
