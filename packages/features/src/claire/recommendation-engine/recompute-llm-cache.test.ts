import type {
  BusinessProfile,
  OrganizationService,
  RankedService,
} from '@borradh-workspace/database';
import { describe, expect, it } from 'vitest';
import { makeService } from '../verticals/aesthetic-clinic/__fixtures__/index.js';
import { recomputeRanking } from './recompute-ranking.js';

const ranked = (serviceId: string, rank: number): RankedService => ({
  serviceId,
  rank,
  score: 1 / rank,
  criteriaScores: {
    retentionFit: 0,
    barrierToEntry: 0,
    crossSell: 0,
    complianceRisk: 0,
  },
  marketPosition: 'at',
  offerStrategy: 'price_visible_intro',
  suggestedIntroPrice: 6500,
  offerStrategyReason: 'llm reason',
  serviceRecommendationCopy: { title: 'Run this', body: 'because' },
  offerRecommendationCopy: { title: 'Intro', body: 'first visit' },
  objections: [],
});

const profile = (
  _services: OrganizationService[],
  rankedServices: RankedService[],
  rankingSource: string | undefined
): BusinessProfile =>
  ({
    id: 'bp_1',
    organizationId: 'org_1',
    vertical: 'aesthetic_clinic',
    retentionModel: 'rebooking',
    commitmentLevel: 'planned',
    marketPosition: 'at',
    axesConfidence: 0.8,
    axesReasoning: 'test',
    classifierAxes: null,
    overriddenAxes: null,
    disagreement: null,
    rankedServices,
    inputHash: 'hash',
    classifiedAt: new Date(),
    classifierVersion: 'aesthetic_clinic@v3',
    verticalMetadata: rankingSource ? { rankingSource } : {},
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as BusinessProfile;

describe('recomputeRanking — honouring the cached LLM decision', () => {
  it('returns the cached order verbatim (no keyword re-rank) when rankingSource is llm', () => {
    const peels = makeService({ name: 'Chemical Peels', priceText: '£100' });
    const facelift = makeService({
      name: 'Non-Surgical Facelift',
      priceText: 'From £450',
    });
    // Cache says peels first (the LLM pick). The keyword ranker would order
    // these differently — honouring the cache means we keep peels at rank 1.
    const cached = [ranked(peels.id, 1), ranked(facelift.id, 2)];
    const result = recomputeRanking(profile([peels, facelift], cached, 'llm'), [
      facelift,
      peels,
    ]);

    expect(result.map((r) => r.serviceId)).toEqual([peels.id, facelift.id]);
    expect(result[0].offerStrategy).toBe('price_visible_intro');
    expect(result[0].suggestedIntroPrice).toBe(6500);
  });

  it('drops a deleted service and appends a newly-added one', () => {
    const peels = makeService({ name: 'Chemical Peels', priceText: '£100' });
    const gone = makeService({ name: 'Old Service', priceText: '£50' });
    const added = makeService({ name: 'New Skin Boosters', priceText: '£200' });
    const cached = [ranked(peels.id, 1), ranked(gone.id, 2)];

    const result = recomputeRanking(
      profile([peels, gone], cached, 'llm'),
      [peels, added] // `gone` deleted, `added` is new
    );

    expect(result.map((r) => r.serviceId)).toEqual([peels.id, added.id]);
    expect(result[1].offerStrategyReason).toMatch(/since the last/i);
  });

  it('falls back to the live keyword path when rankingSource is not llm', () => {
    const peels = makeService({ name: 'Chemical Peels', priceText: '£100' });
    // No rankingSource → keyword path recomputes; with AI uninitialised in
    // tests the keyword ranker still produces a ranking from the menu.
    const result = recomputeRanking(profile([peels], [], undefined), [peels]);
    expect(result.length).toBe(1);
    expect(result[0].serviceId).toBe(peels.id);
  });
});
