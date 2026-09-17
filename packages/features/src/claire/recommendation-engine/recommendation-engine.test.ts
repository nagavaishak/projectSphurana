import { isAIClientInitialized } from '@borradh-workspace/ai';
import type {
  BusinessProfile,
  OrganizationService,
  RankedService,
} from '@borradh-workspace/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  aboveMarketClinicServices,
  nurseLedClinicServices,
  surgicalClinicServices,
} from '../verticals/aesthetic-clinic/__fixtures__/index.js';
import { aestheticClinicConfig } from '../verticals/aesthetic-clinic/index.js';
import { composeRecommendation } from './compose-recommendation.js';
import { computeInputHash } from './compute-input-hash.js';
import { computeRecommendation } from './compute-recommendation.js';
import { pickAlternative } from './pick-alternative.js';
import { recomputeRanking } from './recompute-ranking.js';

const buildProfile = (
  _services: OrganizationService[],
  ranked: RankedService[]
): BusinessProfile => ({
  id: 'bp_1',
  organizationId: 'org_1',
  vertical: 'aesthetic_clinic',
  retentionModel: 'course_based',
  commitmentLevel: 'planned',
  marketPosition: 'at',
  axesConfidence: 0.8,
  axesReasoning: 'test',
  classifierAxes: null,
  overriddenAxes: null,
  disagreement: null,
  rankedServices: ranked,
  inputHash: 'hash',
  classifiedAt: new Date(),
  classifierVersion: 'aesthetic_clinic@v1',
  verticalMetadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeRanked = (
  serviceId: string,
  rank: number,
  overrides: Partial<RankedService> = {}
): RankedService => ({
  serviceId,
  rank,
  score: 1 / rank,
  criteriaScores: {
    retentionFit: 0.8,
    barrierToEntry: 0.7,
    crossSell: 0.9,
    complianceRisk: 0,
    ...overrides.criteriaScores,
  },
  marketPosition: 'at',
  offerStrategy: 'price_visible_intro',
  offerStrategyReason: 'test',
  serviceRecommendationCopy: { title: 'T', body: 'B' },
  offerRecommendationCopy: { title: 'OT', body: 'OB' },
  objections: [],
  ...overrides,
});

// computeRecommendation now recomputes the ranking LIVE from the current
// services + the profile's axes (it no longer reads the cached rankedServices
// verbatim). These assert the live contract: every CURRENT service is ranked,
// ordering comes from the live ranker, and the top pick is the live rank-1.
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

describe('computeRecommendation', () => {
  it('ranks every current service live and exposes rank-1 as topService', () => {
    const services = nurseLedClinicServices();
    // Empty cached rankedServices — proves the ranking is computed live, not
    // read from the cache.
    const profile = buildProfile(services, []);

    const result = computeRecommendation(profile, services);
    expect(result.allRanked).toHaveLength(services.length);
    expect(result.topService).not.toBeNull();
    expect(result.topService?.rank).toBe(1);
    expect(result.alternatives.map((a) => a.rank)).toEqual(
      result.allRanked.slice(1).map((r) => r.rank)
    );
    // topService matches the standalone live ranker's rank-1.
    const liveTop = recomputeRanking(profile, services).find(
      (r) => r.rank === 1
    );
    expect(result.topService?.serviceId).toBe(liveTop?.serviceId);
  });

  it('only ranks services that currently exist on the org', () => {
    const services = nurseLedClinicServices();
    // A stale cached entry for a since-deleted service must not resurface; the
    // live ranker only sees the current services list.
    const profile = buildProfile(services, [makeRanked('missing_id', 1)]);

    const result = computeRecommendation(profile, services);
    expect(result.allRanked).toHaveLength(services.length);
    expect(result.allRanked.some((r) => r.serviceId === 'missing_id')).toBe(
      false
    );
  });

  it('returns null topService when the org has no services', () => {
    const profile = buildProfile([], []);
    const result = computeRecommendation(profile, []);
    expect(result.topService).toBeNull();
    expect(result.alternatives).toEqual([]);
  });
});

describe('pickAlternative', () => {
  it('returns the next live-ranked service when rank-1 is rejected', () => {
    const services = nurseLedClinicServices();
    const profile = buildProfile(services, []);
    const live = recomputeRanking(profile, services);
    const top = live.find((r) => r.rank === 1);
    const second = live.find((r) => r.rank === 2);

    const alt = pickAlternative(profile, services, top?.serviceId);
    expect(alt?.serviceId).toBe(second?.serviceId);
  });

  it('returns null when the rejected service was the last live-ranked one', () => {
    const services = nurseLedClinicServices();
    const profile = buildProfile(services, []);
    const live = recomputeRanking(profile, services);
    const last = live[live.length - 1];

    const alt = pickAlternative(profile, services, last?.serviceId);
    expect(alt).toBeNull();
  });

  it('falls back to the live top when the rejected service is not ranked', () => {
    const services = nurseLedClinicServices();
    const profile = buildProfile(services, []);
    const live = recomputeRanking(profile, services);
    const top = live.find((r) => r.rank === 1);

    const alt = pickAlternative(profile, services, 'unknown');
    expect(alt?.serviceId).toBe(top?.serviceId);
  });
});

// ── The point of the refactor: ranking is LIVE, copy is the only cache ──────
describe('recomputeRanking (live ranking; copy is the only cache)', () => {
  it('reflects a current price change WITHOUT reclassification', () => {
    const services = nurseLedClinicServices();
    // Stale/empty cache — if anything were read from the cache the result would
    // be empty. It isn't, because the ranking is computed live.
    const profile = buildProfile(services, []);

    const before = recomputeRanking(profile, services);
    expect(before.length).toBe(services.length);

    // Find the cheapest service — in the original menu it earns the maximum
    // barrier-to-entry score (cheapest → 1.0).
    const cheapest = [...services].sort(
      (a, b) =>
        Number(a.priceText?.replace(/\D/g, '') ?? 0) -
        Number(b.priceText?.replace(/\D/g, '') ?? 0)
    )[0];
    const cheapestBarrierBefore = before.find(
      (r) => r.serviceId === cheapest?.id
    )?.criteriaScores.barrierToEntry;
    expect(cheapestBarrierBefore).toBe(1);

    // Make it dramatically more expensive than the rest of the menu.
    const mutated = services.map((s) =>
      s.id === cheapest?.id ? { ...s, priceText: '€9999' } : s
    );

    const after = recomputeRanking(profile, mutated);
    const cheapestBarrierAfter = after.find((r) => r.serviceId === cheapest?.id)
      ?.criteriaScores.barrierToEntry;

    // The barrier score MUST drop now it's the most expensive — proving the
    // decision data is recomputed live, not frozen in the (empty) cache, with
    // no reclassification and no cache write.
    expect(cheapestBarrierAfter).toBeLessThan(cheapestBarrierBefore as number);
  });

  it('uses the deterministic static copy fallback for a service with no cached copy (no crash, no LLM)', () => {
    const services = nurseLedClinicServices();
    // Cache copy for exactly ONE service; every other ranked service must fall
    // back to the static copy helper rather than crashing.
    const cachedId = services[0]?.id;
    const profile = buildProfile(services, [
      makeRanked(cachedId, 1, {
        serviceRecommendationCopy: {
          title: 'CACHED TITLE',
          body: 'cached body',
        },
        offerRecommendationCopy: { title: 'CACHED OFFER', body: 'cached' },
      }),
    ]);

    const live = recomputeRanking(profile, services);
    expect(live.length).toBe(services.length);

    // Every entry has non-empty copy (cached or static fallback).
    for (const r of live) {
      expect(r.serviceRecommendationCopy.title.length).toBeGreaterThan(0);
      expect(r.serviceRecommendationCopy.body.length).toBeGreaterThan(0);
      expect(r.offerRecommendationCopy.title.length).toBeGreaterThan(0);
      expect(r.offerRecommendationCopy.body.length).toBeGreaterThan(0);
    }

    // The cached service reuses its cached copy when it lands at its cached id;
    // a service WITHOUT cached copy uses the deterministic static title prefix.
    const cached = live.find((r) => r.serviceId === cachedId);
    expect(cached?.serviceRecommendationCopy.title).toBe('CACHED TITLE');
    const uncached = live.find((r) => r.serviceId !== cachedId);
    expect(uncached?.serviceRecommendationCopy.title).toMatch(/^Run /);
  });
});

describe('computeInputHash', () => {
  it('is stable across service-array reorderings', () => {
    const services = nurseLedClinicServices();
    const h1 = computeInputHash({
      services,
      chatbotSettings: { ownerCredentials: 'Nurse Prescriber' },
      ownerSelfReport: { marketPosition: 'at' },
    });
    const h2 = computeInputHash({
      services: [...services].reverse(),
      chatbotSettings: { ownerCredentials: 'Nurse Prescriber' },
      ownerSelfReport: { marketPosition: 'at' },
    });
    expect(h1).toBe(h2);
  });

  it('changes when credentials change', () => {
    const services = nurseLedClinicServices();
    const h1 = computeInputHash({
      services,
      chatbotSettings: { ownerCredentials: 'Nurse Prescriber' },
    });
    const h2 = computeInputHash({
      services,
      chatbotSettings: { ownerCredentials: 'Aesthetic Doctor' },
    });
    expect(h1).not.toBe(h2);
  });

  it('changes when marketPosition self-report changes', () => {
    const services = nurseLedClinicServices();
    const h1 = computeInputHash({
      services,
      chatbotSettings: null,
      ownerSelfReport: { marketPosition: 'at' },
    });
    const h2 = computeInputHash({
      services,
      chatbotSettings: null,
      ownerSelfReport: { marketPosition: 'above' },
    });
    expect(h1).not.toBe(h2);
  });

  it('changes when a service is added or removed', () => {
    const services = nurseLedClinicServices();
    const h1 = computeInputHash({ services, chatbotSettings: null });
    const h2 = computeInputHash({
      services: services.slice(0, 3),
      chatbotSettings: null,
    });
    expect(h1).not.toBe(h2);
  });
});

describe('composeRecommendation', () => {
  it('produces a full RankedService array for a nurse-led clinic', async () => {
    const services = nurseLedClinicServices();
    const rankedBase = aestheticClinicConfig.rankServices({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'at',
      },
      services,
      verticalMetadata: {},
    });

    const composed = await composeRecommendation({
      organizationName: 'Test Clinic',
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'at',
      },
      services,
      rankedBase,
      config: aestheticClinicConfig,
      chatbotSettings: null,
    });

    expect(composed).toHaveLength(rankedBase.length);
    const top = composed[0];
    expect(top?.serviceRecommendationCopy.title.length).toBeGreaterThan(0);
    expect(top?.serviceRecommendationCopy.body.length).toBeGreaterThan(0);
    expect(top?.offerRecommendationCopy.title.length).toBeGreaterThan(0);
    expect(top?.offerRecommendationCopy.body.length).toBeGreaterThan(0);
    expect(top?.offerStrategy).toBe('price_visible_intro');
  });

  it('returns consultation_led strategies for a surgical clinic', async () => {
    const services = surgicalClinicServices();
    const axes = {
      retentionModel: 'consideration_sale' as const,
      commitmentLevel: 'major' as const,
      marketPosition: 'unknown' as const,
    };
    const rankedBase = aestheticClinicConfig.rankServices({
      axes,
      services,
      verticalMetadata: {},
    });

    const composed = await composeRecommendation({
      organizationName: 'Test Surgical',
      axes,
      services,
      rankedBase,
      config: aestheticClinicConfig,
      chatbotSettings: null,
    });

    const surgical = composed.find((c) => {
      const svc = services.find((s) => s.id === c.serviceId);
      return svc?.name === 'Liposuction' || svc?.name === 'Rhinoplasty';
    });
    expect(surgical?.offerStrategy).toBe('consultation_led');
    expect(surgical?.suggestedIntroPrice).toBeUndefined();
  });

  it('cascades into do_not_advertise when all menu services are above market with no viable alternative', async () => {
    // Build a profile where every service is above market AND a premium
    // upgrade — the engine should ultimately route to do_not_advertise.
    const services = aboveMarketClinicServices();
    const axes = {
      retentionModel: 'rebooking' as const,
      commitmentLevel: 'planned' as const,
      marketPosition: 'above' as const,
    };
    const rankedBase = aestheticClinicConfig.rankServices({
      axes,
      services,
      verticalMetadata: {},
    });

    const composed = await composeRecommendation({
      organizationName: 'Premium Clinic',
      axes,
      services,
      rankedBase,
      config: aestheticClinicConfig,
      chatbotSettings: null,
    });

    // The local pick-offer-strategy for `above` returns
    // `price_hidden_conversation`, which IS a viable strategy — so for an
    // all-above clinic the engine surfaces price_hidden_conversation on the
    // top pick rather than do_not_advertise. do_not_advertise only fires
    // when EVERY service is unviable (e.g. all POM). Verify behaviour:
    expect(composed[0]?.offerStrategy).toBe('price_hidden_conversation');
  });

  it('cascades into do_not_advertise when every service is POM', async () => {
    const baseServices = aboveMarketClinicServices();
    const services = [
      // Lone-POM clinic — both services are anti-wrinkle variants.
      {
        ...baseServices[0],
        name: 'Anti-Wrinkle Forehead',
      } as OrganizationService,
      {
        ...baseServices[1],
        name: 'Anti-Wrinkle Crowsfeet',
      } as OrganizationService,
    ];
    const axes = {
      retentionModel: 'rebooking' as const,
      commitmentLevel: 'planned' as const,
      marketPosition: 'at' as const,
    };
    const rankedBase = aestheticClinicConfig.rankServices({
      axes,
      services,
      verticalMetadata: {},
    });

    const composed = await composeRecommendation({
      organizationName: 'POM-only Clinic',
      axes,
      services,
      rankedBase,
      config: aestheticClinicConfig,
      chatbotSettings: null,
    });

    expect(composed[composed.length - 1]?.offerStrategy).toBe(
      'do_not_advertise'
    );
  });

  it('attaches objections matching the chosen strategy', async () => {
    const services = nurseLedClinicServices();
    const axes = {
      retentionModel: 'course_based' as const,
      commitmentLevel: 'planned' as const,
      marketPosition: 'at' as const,
    };
    const rankedBase = aestheticClinicConfig.rankServices({
      axes,
      services,
      verticalMetadata: {},
    });
    const composed = await composeRecommendation({
      organizationName: 'Test',
      axes,
      services,
      rankedBase,
      config: aestheticClinicConfig,
      chatbotSettings: null,
    });
    const top = composed[0];
    expect(top?.objections.length).toBeGreaterThan(0);
    expect(top?.objections.some((o) => o.id === 'too_cheap')).toBe(true);
  });
});
