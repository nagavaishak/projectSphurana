import type {
  BusinessProfile,
  RankedService,
} from '@borradh-workspace/database';
import { describe, expect, it } from 'vitest';
import {
  renderBusinessProfileContext,
  renderDisagreementNote,
} from './index.js';

const buildProfile = (
  overrides: Partial<BusinessProfile> = {}
): BusinessProfile => ({
  id: 'bp_1',
  organizationId: 'org_1',
  vertical: 'aesthetic_clinic',
  retentionModel: 'course_based',
  commitmentLevel: 'planned',
  marketPosition: 'at',
  axesConfidence: 0.85,
  axesReasoning: 'because',
  classifierAxes: null,
  overriddenAxes: null,
  disagreement: null,
  rankedServices: [],
  inputHash: 'h',
  classifiedAt: new Date(),
  classifierVersion: 'v',
  verticalMetadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const ranked = (
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
  },
  marketPosition: 'at',
  offerStrategy: 'price_visible_intro',
  offerStrategyReason: 'fits the playbook',
  suggestedIntroPrice: 125,
  serviceRecommendationCopy: {
    title: `Run ${serviceId} first`,
    body: 'short rebooking cycle, easy entry point',
  },
  offerRecommendationCopy: { title: 'Offer copy', body: 'Show the price' },
  objections: [
    { id: 'too_cheap', trigger: 'too cheap', response: 'reframe as intro' },
  ],
  ...overrides,
});

describe('renderBusinessProfileContext', () => {
  it('falls back to placeholder when no ranked services', () => {
    const text = renderBusinessProfileContext(buildProfile());
    expect(text).toContain('No ranked services yet');
    expect(text).toContain('classification is still in progress');
  });

  it('renders top 3 services with offer strategy + objections', () => {
    const text = renderBusinessProfileContext(
      buildProfile({
        rankedServices: [
          ranked('svc_a', 1),
          ranked('svc_b', 2),
          ranked('svc_c', 3),
          ranked('svc_d', 4),
        ],
      })
    );
    expect(text).toContain('Top 3 services');
    expect(text).toContain('Run svc_a first');
    expect(text).toContain('Run svc_b first');
    expect(text).toContain('Run svc_c first');
    expect(text).not.toContain('Run svc_d first');
    expect(text).toContain('Offer strategy for top pick: price_visible_intro');
    expect(text).toContain('Suggested intro price: €125');
    expect(text).toContain('too cheap');
    expect(text).toContain(
      'Push the top pick at most ONCE per ad/offer creation cycle'
    );
  });

  it('orders services by rank, not array position', () => {
    const text = renderBusinessProfileContext(
      buildProfile({
        rankedServices: [ranked('svc_b', 2), ranked('svc_a', 1)],
      })
    );
    const idxA = text.indexOf('Run svc_a first');
    const idxB = text.indexOf('Run svc_b first');
    expect(idxA).toBeLessThan(idxB);
  });
});

describe('renderDisagreementNote', () => {
  it('returns null when there is no disagreement', () => {
    expect(renderDisagreementNote(buildProfile())).toBeNull();
  });

  it('returns null when already surfaced', () => {
    expect(
      renderDisagreementNote(
        buildProfile({
          disagreement: {
            axes: ['retentionModel'],
            classifierConfidence: 0.9,
            surfaced: true,
            surfacedAt: new Date().toISOString(),
            resolution: 'pending',
          },
        })
      )
    ).toBeNull();
  });

  it('returns null when the disagreement is already resolved', () => {
    expect(
      renderDisagreementNote(
        buildProfile({
          disagreement: {
            axes: ['retentionModel'],
            classifierConfidence: 0.9,
            surfaced: false,
            surfacedAt: null,
            resolution: 'owner_held',
          },
        })
      )
    ).toBeNull();
  });

  it('returns the disagreement note for a pending, unsurfaced disagreement', () => {
    const note = renderDisagreementNote(
      buildProfile({
        disagreement: {
          axes: ['retentionModel', 'commitmentLevel'],
          classifierConfidence: 0.92,
          surfaced: false,
          surfacedAt: null,
          resolution: 'pending',
        },
      })
    );
    expect(note).toContain('classifier disagreement');
    expect(note).toContain('retentionModel, commitmentLevel');
    expect(note).toContain('0.92');
    expect(note).toContain('ONCE in a non-pushy way');
  });
});
