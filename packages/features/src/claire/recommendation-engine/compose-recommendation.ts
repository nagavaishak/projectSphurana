import type {
  OrganizationService,
  RankedService,
} from '@borradh-workspace/database';
import { extractPriceCents } from '../verticals/aesthetic-clinic/service-taxonomy.js';
import type {
  Axes,
  ObjectionHandler,
  OfferStrategyResult,
  RankedServiceBase,
  ServiceSelection,
  VerticalConfig,
} from '../verticals/types.js';

// Neutral criteria scores for LLM-selected picks. The LLM chooses the order
// holistically rather than emitting the four sub-scores; we keep the field for
// shape-compatibility with the keyword path but don't pretend to fill it.
const NEUTRAL_CRITERIA_SCORES = {
  retentionFit: 0,
  barrierToEntry: 0,
  crossSell: 0,
  complianceRisk: 0,
} as const;

export type ComposeFromSelectionInput = {
  organizationName: string;
  axes: Axes;
  services: OrganizationService[];
  selection: ServiceSelection[];
  config: VerticalConfig;
  chatbotSettings: import('@borradh-workspace/database').ChatbotSettings | null;
};

/**
 * Build the `RankedService[]` from the LLM's `selectServices` output — the
 * model already chose the order, offer strategy and intro price, so we just
 * render the copy and shape each pick. Same output contract as
 * `composeRecommendation`, so every downstream consumer is unchanged.
 *
 * Picks referencing a vanished service are skipped (defensive — selection ids
 * are validated against the menu upstream).
 */
export const composeFromSelection = async (
  input: ComposeFromSelectionInput
): Promise<RankedService[]> => {
  const { selection, services, axes, config, chatbotSettings } = input;
  const servicesById = new Map(services.map((s) => [s.id, s]));

  const composed: RankedService[] = [];
  let rank = 0;
  for (const pick of selection) {
    const service = servicesById.get(pick.serviceId);
    if (!service) continue;
    rank += 1;

    const ranked: RankedServiceBase = {
      serviceId: pick.serviceId,
      rank,
      score: Math.max(0, 1 - (rank - 1) * 0.1),
      criteriaScores: { ...NEUTRAL_CRITERIA_SCORES },
      marketPosition: axes.marketPosition,
      objections: [],
    };
    const offerStrategy: OfferStrategyResult = {
      strategy: pick.offerStrategy,
      suggestedIntroPrice: pick.suggestedIntroPrice,
      reason: pick.reason,
    };

    const [serviceCopy, offerCopy] = await Promise.all([
      config.renderServiceCopy({
        organizationName: input.organizationName,
        axes,
        ranked,
        service,
        chatbotSettings,
      }),
      config.renderOfferCopy({
        organizationName: input.organizationName,
        axes,
        ranked,
        service,
        offerStrategy,
        chatbotSettings,
      }),
    ]);

    composed.push({
      ...ranked,
      offerStrategy: offerStrategy.strategy,
      suggestedIntroPrice: offerStrategy.suggestedIntroPrice,
      offerStrategyReason: offerStrategy.reason,
      serviceRecommendationCopy: serviceCopy,
      offerRecommendationCopy: offerCopy,
      objections: renderObjections(config, offerStrategy.strategy),
    });
  }

  return composed;
};

export type ComposeRecommendationInput = {
  organizationName: string;
  axes: Axes;
  services: OrganizationService[];
  rankedBase: RankedServiceBase[];
  config: VerticalConfig;
  chatbotSettings: import('@borradh-workspace/database').ChatbotSettings | null;
};

// Actionable message used ONLY for the genuine all-POM / no-advertisable-service
// case. Rather than a silent "hold off", it tells the owner exactly how to
// unblock Claire — add a non-prescription treatment she can build a campaign on.
const DO_NOT_ADVERTISE_REASON =
  "Your menu is all prescription-only treatments, which can't be advertised on Meta. Add a non-POM treatment (e.g. microneedling or a facial) and I'll build a campaign around it.";

// The "leadable" strategies that can anchor a cold-traffic ad. switch_service
// is NOT viable (it points elsewhere); do_not_advertise is the terminal dead end.
const VIABLE_STRATEGIES: ReadonlyArray<RankedService['offerStrategy']> = [
  'price_visible_intro',
  'consultation_led',
  'price_hidden_conversation',
];

// Resolves the "above-market with viable alternative → switch_service" cascade
// plus Path B (above-market with a CHEAPER viable alternative → switch to it).
// Walks the ranked list once and decides each service's final offerStrategy
// based on whether a downstream alternative is available, viable, and (for
// Path B) cheaper.
// Exported so the LIVE ranking path (recomputeRanking) reuses the exact same
// Path B / do_not_advertise / switch_service cascade without duplicating it.
export const resolveStrategies = (
  rankedBase: RankedServiceBase[],
  services: OrganizationService[],
  axes: Axes,
  config: VerticalConfig
): OfferStrategyResult[] => {
  const servicesById = new Map(services.map((s) => [s.id, s]));

  // First pass — local decisions per service.
  const local: OfferStrategyResult[] = rankedBase.map((ranked) => {
    const service = servicesById.get(ranked.serviceId);
    if (!service) {
      return {
        strategy: 'switch_service' as const,
        reason: 'Service no longer in menu — switch to the next ranked.',
      };
    }
    return config.pickOfferStrategy({ axes, ranked, service });
  });

  const priceOf = (idx: number): number | undefined => {
    const ranked = rankedBase[idx];
    if (!ranked) return undefined;
    const service = servicesById.get(ranked.serviceId);
    if (!service) return undefined;
    return extractPriceCents(service);
  };

  const nextViableIndex = (
    start: number,
    decisions: OfferStrategyResult[]
  ): number | null => {
    for (let j = start; j < decisions.length; j++) {
      const item = decisions[j];
      if (!item) continue;
      if (VIABLE_STRATEGIES.includes(item.strategy)) {
        return j;
      }
    }
    return null;
  };

  // ── Path B — above-market → switch to a cheaper viable alternative ──────
  // When the clinic is above market, its top pick locally resolves to
  // `price_hidden_conversation` (Path C). But if a CHEAPER viable alternative
  // exists downstream in the ranked list, the spec prefers recommending that
  // cheaper treatment (Path B) over merely hiding the price. We coerce those
  // entries to `switch_service` BEFORE the viable short-circuit below so the
  // cascade routes them. If no cheaper viable alternative exists, the entry
  // stays `price_hidden_conversation` (Path C).
  //
  // Path B only applies when the market position is genuinely `above`. An
  // `unknown` market still yields `price_hidden_conversation`, but with no
  // price anchor we can't say an alternative is "cheaper", so it stays Path C.
  if (axes.marketPosition === 'above') {
    for (let i = 0; i < local.length; i++) {
      const decision = local[i];
      if (!decision || decision.strategy !== 'price_hidden_conversation') {
        continue;
      }
      const ownPrice = priceOf(i);
      if (ownPrice === undefined) continue;

      // Find the first strictly-cheaper downstream service that is itself
      // viable (and not already collapsing to a switch).
      let cheaperIdx: number | null = null;
      for (let j = i + 1; j < local.length; j++) {
        const candidate = local[j];
        if (!candidate || !VIABLE_STRATEGIES.includes(candidate.strategy)) {
          continue;
        }
        const candidatePrice = priceOf(j);
        if (candidatePrice === undefined) continue;
        if (candidatePrice < ownPrice) {
          cheaperIdx = j;
          break;
        }
      }

      if (cheaperIdx !== null) {
        const target = rankedBase[cheaperIdx];
        if (target) {
          local[i] = {
            strategy: 'switch_service',
            reason: `You're priced above market here — switching to ${rankedNameOrId(
              target,
              servicesById
            )} (rank ${target.rank}), a cheaper treatment that's easier to win on cold traffic.`,
          };
        }
      }
    }
  }

  // ── Cascade — resolve switch_service / do_not_advertise terminals ───────
  // Find the first downstream service whose strategy is itself viable. If no
  // viable downstream exists, the entire chain collapses to do_not_advertise
  // (the genuine all-POM / nothing-advertisable case).
  const final: OfferStrategyResult[] = local.map((decision, idx) => {
    if (VIABLE_STRATEGIES.includes(decision.strategy)) return decision;

    // Either explicit switch_service from local pick, a Path B coercion, or an
    // earlier cascade decision.
    const downstream = nextViableIndex(idx + 1, local);
    if (downstream === null) {
      return {
        strategy: 'do_not_advertise',
        reason: DO_NOT_ADVERTISE_REASON,
      };
    }
    const target = rankedBase[downstream];
    if (!target) {
      return {
        strategy: 'do_not_advertise',
        reason: DO_NOT_ADVERTISE_REASON,
      };
    }
    // Preserve a Path B switch's explicit (cheaper-alternative) reason when it
    // already points somewhere viable; only synthesise a generic reason for
    // plain switch_service / POM entries that lack one.
    if (
      decision.strategy === 'switch_service' &&
      decision.reason &&
      !decision.reason.startsWith('POM') &&
      !decision.reason.startsWith('Service no longer')
    ) {
      return decision;
    }
    return {
      strategy: 'switch_service',
      reason: `Switching to ${rankedNameOrId(target, servicesById)} (rank ${target.rank}) — it's the next viable cold-traffic option in your menu.`,
    };
  });

  return final;
};

const rankedNameOrId = (
  ranked: RankedServiceBase,
  services: Map<string, OrganizationService>
): string => services.get(ranked.serviceId)?.name ?? ranked.serviceId;

export const renderObjections = (
  config: VerticalConfig,
  strategy: RankedService['offerStrategy']
): RankedService['objections'] =>
  Object.values(config.objectionHandlers)
    .filter((h: ObjectionHandler) => {
      const restricted = h.appliesTo?.strategies;
      if (!restricted || restricted.length === 0) return true;
      return restricted.includes(strategy);
    })
    .map((h) => ({ id: h.id, trigger: h.trigger, response: h.response }));

export const composeRecommendation = async (
  input: ComposeRecommendationInput
): Promise<RankedService[]> => {
  const { rankedBase, services, axes, config, chatbotSettings } = input;
  if (rankedBase.length === 0) return [];

  const servicesById = new Map(services.map((s) => [s.id, s]));
  const finalStrategies = resolveStrategies(rankedBase, services, axes, config);

  // Render copy for each ranked service. Done sequentially to keep token
  // usage predictable; switch to Promise.all if latency becomes a concern.
  const composed: RankedService[] = [];
  for (let i = 0; i < rankedBase.length; i++) {
    const ranked = rankedBase[i];
    const offerStrategy = finalStrategies[i];
    if (!ranked || !offerStrategy) continue;
    const service = servicesById.get(ranked.serviceId);
    // If the service vanished mid-compose, emit a minimal record so the
    // caller can still match against the rank order (pickAlternative cleans
    // these later).
    if (!service) {
      composed.push({
        ...ranked,
        offerStrategy: 'switch_service',
        offerStrategyReason:
          'Service no longer exists in menu. Switch to the next ranked service.',
        serviceRecommendationCopy: {
          title: 'Service unavailable',
          body: 'This service is no longer in the menu.',
        },
        offerRecommendationCopy: {
          title: 'Service unavailable',
          body: 'This service is no longer in the menu.',
        },
        objections: [],
      });
      continue;
    }

    const [serviceCopy, offerCopy] = await Promise.all([
      config.renderServiceCopy({
        organizationName: input.organizationName,
        axes,
        ranked,
        service,
        chatbotSettings,
      }),
      config.renderOfferCopy({
        organizationName: input.organizationName,
        axes,
        ranked,
        service,
        offerStrategy,
        chatbotSettings,
      }),
    ]);

    composed.push({
      ...ranked,
      offerStrategy: offerStrategy.strategy,
      suggestedIntroPrice: offerStrategy.suggestedIntroPrice,
      offerStrategyReason: offerStrategy.reason,
      serviceRecommendationCopy: serviceCopy,
      offerRecommendationCopy: offerCopy,
      objections: renderObjections(config, offerStrategy.strategy),
    });
  }

  return composed;
};
