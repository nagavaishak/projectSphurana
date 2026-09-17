import type {
  BusinessVertical,
  ChatbotSettings,
  CommitmentLevel,
  MarketPosition,
  OfferStrategy,
  OrganizationService,
  RankedService,
  RetentionModel,
} from '@borradh-workspace/database';

/**
 * One service the LLM picked to advertise, in priority order. This is the
 * judgement that used to come from the brittle keyword taxonomy + scoring:
 * the model reads the real menu and applies the spec's selection rules
 * directly (North Star, clinic-type hierarchy, POM/surgical guards,
 * don't-advertise-non-pain-point), so naming variation stops mattering.
 */
export type ServiceSelection = {
  serviceId: string;
  offerStrategy: OfferStrategy;
  /** Suggested first-visit intro price in cents, when the strategy carries one. */
  suggestedIntroPrice?: number;
  /** One-line "why this service / why this strategy" for the recommendation copy. */
  reason: string;
};

export type SelectServicesInput = {
  organizationName: string;
  services: OrganizationService[];
  axes: Axes;
  chatbotSettings: ChatbotSettings | null;
  verticalMetadata: Record<string, unknown>;
};

export type AxisOverrides = Partial<{
  retentionModel: RetentionModel;
  commitmentLevel: CommitmentLevel;
  marketPosition: MarketPosition;
}>;

export type Axes = {
  retentionModel: RetentionModel;
  commitmentLevel: CommitmentLevel;
  marketPosition: MarketPosition;
};

export type ClassifyInput = {
  organizationName: string;
  services: OrganizationService[];
  chatbotSettings: ChatbotSettings | null;
  ownerSelfReport?: {
    vertical?: BusinessVertical;
    marketPosition?: MarketPosition;
  };
  constraints?: AxisOverrides;
};

export type ClassifierUnconstrainedAxes = Axes & { confidence: number };

export type ClassifyResult = {
  effective: Axes;
  classifierUnconstrained: ClassifierUnconstrainedAxes;
  confidence: number;
  reasoning: string;
  verticalMetadata: Record<string, unknown>;
};

export type RankedServiceBase = Omit<
  RankedService,
  | 'offerStrategy'
  | 'suggestedIntroPrice'
  | 'offerStrategyReason'
  | 'serviceRecommendationCopy'
  | 'offerRecommendationCopy'
>;

export type RankServicesInput = {
  axes: Axes;
  services: OrganizationService[];
  verticalMetadata: Record<string, unknown>;
};

export type OfferStrategyResult = {
  strategy: OfferStrategy;
  suggestedIntroPrice?: number;
  reason: string;
};

export type PickOfferStrategyInput = {
  axes: Axes;
  ranked: RankedServiceBase;
  service: OrganizationService;
};

export type RenderServiceCopyInput = {
  organizationName: string;
  axes: Axes;
  ranked: RankedServiceBase;
  service: OrganizationService;
  chatbotSettings: ChatbotSettings | null;
};

export type RenderOfferCopyInput = {
  organizationName: string;
  axes: Axes;
  ranked: RankedServiceBase;
  service: OrganizationService;
  offerStrategy: OfferStrategyResult;
  chatbotSettings: ChatbotSettings | null;
};

export type ObjectionHandler = {
  id: string;
  trigger: string;
  response: string;
  appliesTo?: {
    strategies?: OfferStrategy[];
    services?: string[];
  };
};

export interface VerticalConfig {
  vertical: BusinessVertical;
  version: string;

  classify(input: ClassifyInput): Promise<ClassifyResult>;

  /**
   * LLM-first service selection — the PRIMARY ranker. Reads the real menu and
   * returns the services to advertise in priority order, with each one's offer
   * strategy + intro price. Returns `null` when the LLM is unavailable (no API
   * key) or its output can't be used, in which case the engine falls back to
   * the deterministic `rankServices` keyword path. Optional so verticals can
   * ship without it (keyword-only).
   */
  selectServices?(
    input: SelectServicesInput
  ): Promise<ServiceSelection[] | null>;

  rankServices(input: RankServicesInput): RankedServiceBase[];

  pickOfferStrategy(input: PickOfferStrategyInput): OfferStrategyResult;

  renderServiceCopy(
    input: RenderServiceCopyInput
  ): Promise<{ title: string; body: string }>;

  renderOfferCopy(
    input: RenderOfferCopyInput
  ): Promise<{ title: string; body: string }>;

  // Deterministic, SYNC, NO-LLM copy. These are the static fallbacks that
  // `renderServiceCopy` / `renderOfferCopy` return when the AI client is
  // unavailable or the LLM output fails validation. The live ranking path
  // (recomputeRanking) calls these directly for any service that has no
  // cached copy on the profile, so the read path never touches an LLM.
  staticServiceCopy(input: RenderServiceCopyInput): {
    title: string;
    body: string;
  };

  staticOfferCopy(input: RenderOfferCopyInput): {
    title: string;
    body: string;
  };

  objectionHandlers: Record<string, ObjectionHandler>;
}
