import { isAIClientInitialized } from '@borradh-workspace/ai';
import type { OrganizationService } from '@borradh-workspace/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// composeRecommendation calls config.renderServiceCopy / renderOfferCopy, which
// for the aesthetic-clinic config are deterministic (no live AI in tests). Stub
// the AI client init so nothing reaches the network.

import { makeService } from '../verticals/aesthetic-clinic/__fixtures__/index.js';
import { aestheticClinicConfig } from '../verticals/aesthetic-clinic/index.js';
import type { Axes, RankedServiceBase } from '../verticals/types.js';
import { composeRecommendation } from './compose-recommendation.js';

// Build a RankedServiceBase in explicit rank order so tests control the cascade
// independently of rankServices' weighting.
const makeRankedBase = (
  serviceId: string,
  rank: number,
  complianceRisk = 0
): RankedServiceBase => ({
  serviceId,
  rank,
  score: 1 / rank,
  criteriaScores: {
    retentionFit: 0.8,
    barrierToEntry: 0.7,
    crossSell: 0.6,
    complianceRisk,
  },
  marketPosition: 'above',
  objections: [],
});

const compose = (
  services: OrganizationService[],
  rankedBase: RankedServiceBase[],
  axes: Axes
) =>
  composeRecommendation({
    organizationName: 'Test Clinic',
    axes,
    services,
    rankedBase,
    config: aestheticClinicConfig,
    chatbotSettings: null,
  });

const aboveAxes: Axes = {
  retentionModel: 'rebooking',
  commitmentLevel: 'planned',
  marketPosition: 'above',
};

// `@borradh-workspace/ai` is canonically mocked (vite.config.ts alias). These
// tests exercise the no-API-key static path, so force `isAIClientInitialized`
// false here and restore the canonical `true` after, to avoid leaking the
// override across the shared worker graph under `isolate: false`. See
// docs/plans/features-test-suite-speedup.md.
beforeEach(() => {
  vi.mocked(isAIClientInitialized).mockReturnValue(false);
});
afterEach(() => {
  vi.mocked(isAIClientInitialized).mockReturnValue(true);
});

describe('composeRecommendation — Path B (above-market → switch to cheaper)', () => {
  it('B1: above-market top pick switches to a cheaper viable alternative', async () => {
    // Top pick is the pricier non-POM treatment; rank-2 is a cheaper non-POM
    // treatment. Above-market → Path B should switch to the cheaper one.
    const expensive = makeService({
      name: 'Polynucleotides',
      priceText: '€500',
    });
    const cheaper = makeService({ name: 'Microneedling', priceText: '€180' });
    const services = [expensive, cheaper];
    const rankedBase = [
      makeRankedBase(expensive.id, 1),
      makeRankedBase(cheaper.id, 2),
    ];

    const composed = await compose(services, rankedBase, aboveAxes);

    expect(composed[0]?.offerStrategy).toBe('switch_service');
    expect(composed[0]?.offerStrategyReason).toContain('Microneedling');
    // The cheaper alternative itself stays a viable, leadable strategy.
    expect(composed[1]?.offerStrategy).toBe('price_hidden_conversation');
  });

  it('B1: above-market top pick with NO cheaper alternative stays price-hidden', async () => {
    // Top pick is the CHEAPEST non-POM treatment — nothing cheaper downstream,
    // so it stays Path C (price_hidden_conversation), no switch.
    const cheapest = makeService({ name: 'Microneedling', priceText: '€180' });
    const pricier = makeService({ name: 'Polynucleotides', priceText: '€500' });
    const services = [cheapest, pricier];
    const rankedBase = [
      makeRankedBase(cheapest.id, 1),
      makeRankedBase(pricier.id, 2),
    ];

    const composed = await compose(services, rankedBase, aboveAxes);

    expect(composed[0]?.offerStrategy).toBe('price_hidden_conversation');
  });

  it('B1: single above-market service (no alternatives) stays price-hidden', async () => {
    const only = makeService({ name: 'Microneedling', priceText: '€180' });
    const services = [only];
    const rankedBase = [makeRankedBase(only.id, 1)];

    const composed = await compose(services, rankedBase, aboveAxes);

    expect(composed[0]?.offerStrategy).toBe('price_hidden_conversation');
  });

  it('B1: a more expensive downstream service does NOT trigger a switch', async () => {
    // Top pick cheaper than rank-2 → no cheaper alternative → stays price-hidden.
    const top = makeService({ name: 'Microneedling', priceText: '€200' });
    const pricier = makeService({ name: 'Profhilo', priceText: '€450' });
    const services = [top, pricier];
    const rankedBase = [
      makeRankedBase(top.id, 1),
      makeRankedBase(pricier.id, 2),
    ];

    const composed = await compose(services, rankedBase, aboveAxes);

    expect(composed[0]?.offerStrategy).toBe('price_hidden_conversation');
  });
});

describe('composeRecommendation — market positions other than above are untouched', () => {
  it('Path A: at-market service yields price_visible_intro (unchanged)', async () => {
    const svc = makeService({ name: 'Microneedling', priceText: '€180' });
    const cheaper = makeService({ name: 'Chemical Peel', priceText: '€120' });
    const services = [svc, cheaper];
    const rankedBase = [
      makeRankedBase(svc.id, 1),
      makeRankedBase(cheaper.id, 2),
    ];

    const composed = await compose(services, rankedBase, {
      retentionModel: 'rebooking',
      commitmentLevel: 'planned',
      marketPosition: 'at',
    });

    // At-market never enters Path B even though a cheaper alt exists.
    expect(composed[0]?.offerStrategy).toBe('price_visible_intro');
  });

  it('surgical / major commitment stays consultation_led (unchanged)', async () => {
    const lipo = makeService({ name: 'Liposuction', priceText: '€4500' });
    const cheaper = makeService({ name: 'Microneedling', priceText: '€150' });
    const services = [lipo, cheaper];
    const rankedBase = [
      makeRankedBase(lipo.id, 1),
      makeRankedBase(cheaper.id, 2),
    ];

    const composed = await compose(services, rankedBase, {
      retentionModel: 'consideration_sale',
      commitmentLevel: 'major',
      marketPosition: 'above',
    });

    // Major-commitment branch wins before the market-position branch, so even
    // an above-market surgical pick stays consultation_led (no Path B switch).
    expect(composed[0]?.offerStrategy).toBe('consultation_led');
    expect(composed[0]?.suggestedIntroPrice).toBeUndefined();
  });
});

describe('composeRecommendation — B2 actionable do_not_advertise', () => {
  it('all-POM menu yields an actionable do_not_advertise message', async () => {
    const pom1 = makeService({
      name: 'Anti-Wrinkle Forehead',
      priceText: '€200',
    });
    const pom2 = makeService({
      name: 'Anti-Wrinkle Crowsfeet',
      priceText: '€220',
    });
    const services = [pom1, pom2];
    // POM services flag complianceRisk; pick-offer-strategy returns switch_service.
    const rankedBase = [
      makeRankedBase(pom1.id, 1, 1),
      makeRankedBase(pom2.id, 2, 1),
    ];

    const composed = await compose(services, rankedBase, {
      retentionModel: 'rebooking',
      commitmentLevel: 'planned',
      marketPosition: 'at',
    });

    const last = composed[composed.length - 1];
    expect(last?.offerStrategy).toBe('do_not_advertise');
    // Actionable, not a silent "hold off".
    expect(last?.offerStrategyReason).toMatch(/add a non-POM treatment/i);
    expect(last?.offerStrategyReason).not.toMatch(/hold off/i);
  });

  it('a menu with at least one non-POM service never reaches do_not_advertise', async () => {
    const pom = makeService({ name: 'Anti-Wrinkle', priceText: '€200' });
    const nonPom = makeService({ name: 'Microneedling', priceText: '€180' });
    const services = [pom, nonPom];
    const rankedBase = [
      makeRankedBase(pom.id, 1, 1),
      makeRankedBase(nonPom.id, 2, 0),
    ];

    const composed = await compose(services, rankedBase, {
      retentionModel: 'rebooking',
      commitmentLevel: 'planned',
      marketPosition: 'at',
    });

    expect(composed.every((c) => c.offerStrategy !== 'do_not_advertise')).toBe(
      true
    );
    // The POM entry switches to the viable non-POM treatment.
    expect(composed[0]?.offerStrategy).toBe('switch_service');
  });
});
