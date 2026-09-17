import { chatCompletion, isAIClientInitialized } from '@borradh-workspace/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Force the LLM client into the "not initialised + no API key" branch so all
// tests exercise the heuristic / static fallbacks. The real chatCompletion
// is never reached.

import {
  aboveMarketClinicServices,
  beautyTherapistServices,
  bodyContouringServices,
  nurseLedClinicServices,
  surgicalClinicServices,
} from './__fixtures__/index.js';
import { aestheticClinicConfig, heuristicClassify } from './index.js';
import { pickOfferStrategy } from './pick-offer-strategy.js';
import { rankServices } from './rank-services.js';
import { extractPriceCents, taxonomiseService } from './service-taxonomy.js';

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

describe('aestheticClinicConfig', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = undefined;
  });

  it('registers as aesthetic_clinic@v3', () => {
    expect(aestheticClinicConfig.vertical).toBe('aesthetic_clinic');
    expect(aestheticClinicConfig.version).toBe('aesthetic_clinic@v3');
  });
});

describe('taxonomiseService', () => {
  it('flags POM treatments', () => {
    expect(taxonomiseService({ name: 'Botox' }).isPOM).toBe(true);
    expect(taxonomiseService({ name: 'Anti-Wrinkle Injections' }).isPOM).toBe(
      true
    );
    expect(taxonomiseService({ name: 'Fat Dissolving Small' }).isPOM).toBe(
      true
    );
  });

  it('flags surgical procedures', () => {
    expect(taxonomiseService({ name: 'Rhinoplasty' }).isSurgical).toBe(true);
    expect(taxonomiseService({ name: 'Liposuction' }).cadence).toBe(
      'consideration_sale'
    );
  });

  it('flags first-trust-builders', () => {
    expect(
      taxonomiseService({ name: 'Microneedling' }).isFirstTrustBuilder
    ).toBe(true);
    expect(
      taxonomiseService({ name: 'Chemical Peel' }).isFirstTrustBuilder
    ).toBe(true);
  });

  it('returns unknown for unrecognised names', () => {
    expect(taxonomiseService({ name: 'Bespoke Wellness Pod' }).canonical).toBe(
      'unknown'
    );
  });
});

describe('extractPriceCents', () => {
  it('parses simple euro prices', () => {
    expect(extractPriceCents({ priceText: '€200 per session' })).toBe(20000);
    expect(extractPriceCents({ priceText: '€80' })).toBe(8000);
  });

  it('picks the lowest price when description quotes a package', () => {
    expect(
      extractPriceCents({
        priceText: '€200 per session, package of 3 for €500',
      })
    ).toBe(20000);
  });

  it('handles GBP and prefix-less numbers', () => {
    expect(extractPriceCents({ priceText: '£90' })).toBe(9000);
    expect(extractPriceCents({ priceText: '125 per visit' })).toBe(12500);
  });

  it('returns undefined for empty or unparseable descriptions', () => {
    expect(extractPriceCents({ priceText: null })).toBeUndefined();
    expect(extractPriceCents({ priceText: 'POA' })).toBeUndefined();
  });
});

describe('rankServices — nurse-led clinic', () => {
  it('puts a course-based trust-builder at rank 1 (microneedling or peel)', () => {
    const services = nurseLedClinicServices();
    const ranked = rankServices({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'at',
      },
      services,
      verticalMetadata: {},
    });

    const top = services.find((s) => s.id === ranked[0]?.serviceId);
    // The algorithm correctly favours the cheapest course-based
    // trust-builder. For this fixture that's Chemical Peel (€120) over
    // Microneedling (€180); both are valid rank-1 picks for nurse-led.
    expect(['Microneedling', 'Chemical Peel']).toContain(top?.name);
  });

  it('demotes POM services to the bottom of the list', () => {
    const services = nurseLedClinicServices();
    const ranked = rankServices({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'at',
      },
      services,
      verticalMetadata: {},
    });

    const antiWrinkle = ranked.find((r) => {
      const svc = services.find((s) => s.id === r.serviceId);
      return svc?.name === 'Anti-Wrinkle Injections';
    });
    expect(antiWrinkle).toBeDefined();
    // POM complianceRisk should be 1.0.
    expect(antiWrinkle?.criteriaScores.complianceRisk).toBe(1.0);
    // And rank below at least one non-POM service.
    expect(antiWrinkle?.rank).toBeGreaterThan(1);
  });
});

describe('rankServices — surgical clinic', () => {
  it('puts surgical procedures at rank 1 for a consideration-sale clinic', () => {
    const services = surgicalClinicServices();
    const ranked = rankServices({
      axes: {
        retentionModel: 'consideration_sale',
        commitmentLevel: 'major',
        marketPosition: 'unknown',
      },
      services,
      verticalMetadata: {},
    });
    const top = services.find((s) => s.id === ranked[0]?.serviceId);
    expect(['Liposuction', 'Rhinoplasty']).toContain(top?.name);
  });
});

describe('rankServices — beauty-therapist clinic', () => {
  it('pins the head spa to the top (A2 — head spa preferred)', () => {
    const services = beautyTherapistServices();
    const ranked = rankServices({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'impulse',
        marketPosition: 'at',
      },
      services,
      verticalMetadata: {},
    });
    const top = services.find((s) => s.id === ranked[0]?.serviceId);
    // Beauty-therapist + not above-market → the demand-wave head spa is the
    // hero, ahead of microneedling / cheaper impulse treatments.
    expect(top?.name).toBe('Head Spa');
  });
});

describe('rankServices — edge cases', () => {
  it('returns empty for empty services list', () => {
    const ranked = rankServices({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'at',
      },
      services: [],
      verticalMetadata: {},
    });
    expect(ranked).toEqual([]);
  });

  it('returns a single rank-1 entry for a single-service org', () => {
    const services = nurseLedClinicServices().slice(0, 1);
    const ranked = rankServices({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'at',
      },
      services,
      verticalMetadata: {},
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.rank).toBe(1);
  });

  it('produces stable order for tied scores', () => {
    const services = nurseLedClinicServices();
    const axes = {
      retentionModel: 'course_based' as const,
      commitmentLevel: 'planned' as const,
      marketPosition: 'at' as const,
    };
    const a = rankServices({ axes, services, verticalMetadata: {} });
    const b = rankServices({
      axes,
      services: [...services].reverse(),
      verticalMetadata: {},
    });
    expect(a.map((r) => r.serviceId).sort()).toEqual(
      b.map((r) => r.serviceId).sort()
    );
    // The TOP-ranked service id should be identical between runs.
    expect(a[0]?.serviceId).toBe(b[0]?.serviceId);
  });
});

describe('pickOfferStrategy', () => {
  const services = nurseLedClinicServices();
  const microneedling = services.find((s) => s.name === 'Microneedling');
  const antiWrinkle = services.find(
    (s) => s.name === 'Anti-Wrinkle Injections'
  );
  if (!microneedling || !antiWrinkle) {
    throw new Error('Fixture missing expected services');
  }
  const baseRanked = {
    serviceId: microneedling.id,
    rank: 1,
    score: 0.8,
    criteriaScores: {
      retentionFit: 1.0,
      barrierToEntry: 0.7,
      crossSell: 0.9,
      complianceRisk: 0.0,
    },
    marketPosition: 'at' as const,
    objections: [] as never[],
  };

  it('returns switch_service for POM treatments', () => {
    const result = pickOfferStrategy({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'at',
      },
      ranked: {
        ...baseRanked,
        criteriaScores: { ...baseRanked.criteriaScores, complianceRisk: 1.0 },
        serviceId: antiWrinkle.id,
      },
      service: antiWrinkle,
    });
    expect(result.strategy).toBe('switch_service');
  });

  it('returns consultation_led for major commitment', () => {
    const result = pickOfferStrategy({
      axes: {
        retentionModel: 'consideration_sale',
        commitmentLevel: 'major',
        marketPosition: 'unknown',
      },
      ranked: baseRanked,
      service: microneedling,
    });
    expect(result.strategy).toBe('consultation_led');
    expect(result.suggestedIntroPrice).toBeUndefined();
  });

  it('returns price_visible_intro at 70% for marketPosition=at', () => {
    const result = pickOfferStrategy({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'at',
      },
      ranked: baseRanked,
      service: microneedling,
    });
    expect(result.strategy).toBe('price_visible_intro');
    // €180 → 70% → €126 → 12600 cents.
    expect(result.suggestedIntroPrice).toBe(12600);
  });

  it('returns price_visible_intro at 85% for marketPosition=below', () => {
    const result = pickOfferStrategy({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'below',
      },
      ranked: baseRanked,
      service: microneedling,
    });
    expect(result.strategy).toBe('price_visible_intro');
    // €180 → 85% → €153 → 15300 cents.
    expect(result.suggestedIntroPrice).toBe(15300);
  });

  it('returns price_hidden_conversation for marketPosition=above', () => {
    const result = pickOfferStrategy({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'above',
      },
      ranked: baseRanked,
      service: microneedling,
    });
    expect(result.strategy).toBe('price_hidden_conversation');
    expect(result.suggestedIntroPrice).toBeUndefined();
  });

  it('returns price_hidden_conversation for marketPosition=unknown', () => {
    const result = pickOfferStrategy({
      axes: {
        retentionModel: 'course_based',
        commitmentLevel: 'planned',
        marketPosition: 'unknown',
      },
      ranked: baseRanked,
      service: microneedling,
    });
    expect(result.strategy).toBe('price_hidden_conversation');
  });
});

describe('heuristicClassify', () => {
  it('classifies a surgical clinic as consideration_sale + major', () => {
    const result = heuristicClassify({
      organizationName: 'Test Surgical',
      services: surgicalClinicServices(),
      chatbotSettings: { ownerCredentials: 'Consultant Plastic Surgeon' },
    });
    expect(result.effective.retentionModel).toBe('consideration_sale');
    expect(result.effective.commitmentLevel).toBe('major');
  });

  it('classifies a beauty therapist as course_based + impulse', () => {
    const result = heuristicClassify({
      organizationName: 'The Beauty Room',
      services: beautyTherapistServices(),
      chatbotSettings: { ownerCredentials: 'Level 3 Beauty Therapist CIDESCO' },
    });
    expect(result.effective.retentionModel).toBe('course_based');
    expect(result.effective.commitmentLevel).toBe('impulse');
    expect(result.verticalMetadata.ownerQualification).toBe('beauty_therapist');
  });

  it('classifies a nurse-led injectable clinic as course_based + planned', () => {
    const result = heuristicClassify({
      organizationName: 'Test Nurse Clinic',
      services: nurseLedClinicServices(),
      chatbotSettings: {
        ownerCredentials: 'Registered Nurse Prescriber',
      },
    });
    expect(result.effective.retentionModel).toBe('course_based');
    expect(result.effective.commitmentLevel).toBe('planned');
    expect(result.verticalMetadata.isPrescriber).toBe(true);
  });

  it('classifies a body-contouring clinic as course_based + planned', () => {
    const result = heuristicClassify({
      organizationName: 'Body Studio',
      services: bodyContouringServices(),
      chatbotSettings: null,
    });
    expect(result.effective.retentionModel).toBe('course_based');
    expect(result.effective.commitmentLevel).toBe('planned');
    expect(result.verticalMetadata.hasBodyContouring).toBe(true);
  });

  it('owner overrides are applied as constraints on top of unconstrained guess', () => {
    const result = heuristicClassify({
      organizationName: 'Test',
      services: nurseLedClinicServices(),
      chatbotSettings: {
        ownerCredentials: 'Registered Nurse Prescriber',
      },
      constraints: { commitmentLevel: 'impulse' },
    });
    expect(result.effective.commitmentLevel).toBe('impulse');
    // Unconstrained guess should still be planned — the disagreement signal
    // for the engine to surface.
    expect(result.classifierUnconstrained.commitmentLevel).toBe('planned');
  });

  it('returns market position from owner self-report when provided', () => {
    const result = heuristicClassify({
      organizationName: 'Test',
      services: nurseLedClinicServices(),
      chatbotSettings: null,
      ownerSelfReport: { marketPosition: 'above' },
    });
    expect(result.effective.marketPosition).toBe('above');
  });
});

describe('aestheticClinicConfig.classify (LLM disabled)', () => {
  it('falls back to heuristic when OPENAI_API_KEY is unset', async () => {
    const result = await aestheticClinicConfig.classify({
      organizationName: 'Test',
      services: nurseLedClinicServices(),
      chatbotSettings: { ownerCredentials: 'Registered Nurse Prescriber' },
    });
    expect(result.effective.retentionModel).toBe('course_based');
    expect(result.verticalMetadata.source).toBe('heuristic_fallback');
  });
});

describe('aestheticClinicConfig.classify (LLM request budget)', () => {
  it('bounds each provider attempt and owns retries at the classifier layer', async () => {
    vi.mocked(isAIClientInitialized).mockReturnValue(true);
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: JSON.stringify({
        effective: {
          retentionModel: 'course_based',
          commitmentLevel: 'planned',
          marketPosition: 'at',
        },
        classifierUnconstrained: {
          retentionModel: 'course_based',
          commitmentLevel: 'planned',
          marketPosition: 'at',
          confidence: 0.9,
        },
        confidence: 0.9,
        reasoning: 'Course-based treatments dominate the menu.',
      }),
      finishReason: 'stop',
    });

    await aestheticClinicConfig.classify({
      organizationName: 'Test',
      services: nurseLedClinicServices(),
      chatbotSettings: null,
    });

    expect(chatCompletion).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeoutMs: 20_000, maxRetries: 0 })
    );
  });
});

describe('above-market fixture sanity check', () => {
  it('produces an all-rebooking/premium menu with no first-trust-builder', () => {
    const services = aboveMarketClinicServices();
    const flags = services.map((s) => taxonomiseService(s));
    expect(flags.every((f) => !f.isFirstTrustBuilder)).toBe(true);
  });
});
