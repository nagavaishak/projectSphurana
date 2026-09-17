import { trackOrgEvent } from '@borradh-workspace/observability';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/observability` is canonically mocked via vite.config.ts
// alias (the real module never loads; every file shares the same mock). Drive
// `trackOrgEvent` with vi.mocked() — a file-local `vi.mock` would leak across
// the shared worker graph under `isolate: false`. See
// docs/plans/features-test-suite-speedup.md.
const trackOrgEventMock = vi.mocked(trackOrgEvent);

import {
  trackClassifierDisagreementDetected,
  trackClassifierFailed,
  trackClassifierRun,
  trackDisagreementIgnoredAuto,
  trackDisagreementResolved,
  trackDisagreementSurfaced,
  trackRecommendationAbandoned,
  trackRecommendationAccepted,
  trackRecommendationDismissed,
  trackRecommendationDraftSaved,
  trackRecommendationEdited,
  trackRecommendationImpression,
  trackRecommendationPublished,
} from './track.js';

const orgId = 'org_telemetry';

beforeEach(() => {
  trackOrgEventMock.mockClear();
});

afterEach(() => {
  trackOrgEventMock.mockReset();
});

describe('recommendation funnel', () => {
  it('impression event uses correct name and flat properties', () => {
    trackRecommendationImpression(orgId, {
      surface: 'chat',
      kind: 'ad_flow_service_pick',
      rankedServiceId: 'svc_1',
      rank: 1,
      marketPosition: 'at',
      offerStrategy: 'price_visible_intro',
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.recommendation.impression',
      expect.objectContaining({
        surface: 'chat',
        kind: 'ad_flow_service_pick',
        rankedServiceId: 'svc_1',
        rank: 1,
        marketPosition: 'at',
        offerStrategy: 'price_visible_intro',
      })
    );
  });

  it('accepted event carries acceptedAtRank', () => {
    trackRecommendationAccepted(orgId, {
      surface: 'chat',
      kind: 'ad_flow_service_pick',
      rankedServiceId: 'svc_1',
      rank: 2,
      acceptedAtRank: 2,
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.recommendation.accepted',
      expect.objectContaining({ acceptedAtRank: 2 })
    );
  });

  it('dismissed event carries dismissReason', () => {
    trackRecommendationDismissed(orgId, {
      surface: 'ads_new',
      kind: 'ad_flow_service_pick',
      rankedServiceId: 'svc_1',
      rank: 1,
      dismissReason: 'show_alternative',
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.recommendation.dismissed',
      expect.objectContaining({ dismissReason: 'show_alternative' })
    );
  });

  it('edited event flattens editedFields to comma-joined string', () => {
    trackRecommendationEdited(orgId, {
      surface: 'chat',
      kind: 'ad_flow_service_pick',
      rankedServiceId: 'svc_1',
      rank: 1,
      acceptedAtRank: 1,
      editedFields: ['primaryText', 'headline'],
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.recommendation.edited',
      expect.objectContaining({
        // sorted for stable dashboard filters
        editedFields: 'headline,primaryText',
        editedFieldCount: 2,
      })
    );
  });

  it('published event records secondsFromImpression', () => {
    trackRecommendationPublished(orgId, {
      surface: 'chat',
      kind: 'ad_flow_service_pick',
      rankedServiceId: 'svc_1',
      rank: 1,
      acceptedAtRank: 1,
      publishedAdId: 'ad_1',
      secondsFromImpression: 42,
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.recommendation.published',
      expect.objectContaining({
        publishedAdId: 'ad_1',
        secondsFromImpression: 42,
      })
    );
  });

  it('draft_saved event carries draftId', () => {
    trackRecommendationDraftSaved(orgId, {
      surface: 'chat',
      kind: 'ad_flow_offer_pick',
      rankedServiceId: 'svc_1',
      rank: 1,
      acceptedAtRank: 1,
      draftId: 'draft_1',
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.recommendation.draft_saved',
      expect.objectContaining({ draftId: 'draft_1' })
    );
  });

  it('abandoned event carries state', () => {
    trackRecommendationAbandoned(orgId, {
      surface: 'ads_new',
      kind: 'ad_flow_service_pick',
      rankedServiceId: 'svc_1',
      rank: 1,
      state: 'never_accepted',
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.recommendation.abandoned',
      expect.objectContaining({ state: 'never_accepted' })
    );
  });
});

describe('disagreement funnel', () => {
  const baseProps = {
    surface: 'ads_new' as const,
    axes: ['retentionModel', 'commitmentLevel'],
    classifierConfidence: 0.92,
    ownerOverride: {
      retentionModel: 'rebooking',
      commitmentLevel: undefined,
      marketPosition: undefined,
    },
    classifierProposal: {
      retentionModel: 'course_based',
      commitmentLevel: undefined,
      marketPosition: undefined,
    },
  };

  it('surfaced event flattens axes + nested overrides', () => {
    trackDisagreementSurfaced(orgId, baseProps);
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.disagreement.surfaced',
      expect.objectContaining({
        axes: 'commitmentLevel,retentionModel',
        axisCount: 2,
        classifierConfidence: 0.92,
        ownerOverrideRetentionModel: 'rebooking',
        classifierProposalRetentionModel: 'course_based',
      })
    );
  });

  it('resolved event carries resolution', () => {
    trackDisagreementResolved(orgId, {
      ...baseProps,
      resolution: 'owner_changed',
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.disagreement.resolved',
      expect.objectContaining({ resolution: 'owner_changed' })
    );
  });

  it('ignored_auto event carries daysSinceSurfaced', () => {
    trackDisagreementIgnoredAuto(orgId, {
      ...baseProps,
      daysSinceSurfaced: 31,
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.disagreement.ignored_auto',
      expect.objectContaining({ daysSinceSurfaced: 31 })
    );
  });
});

describe('classifier events', () => {
  const baseProps = {
    organizationId: orgId,
    vertical: 'aesthetic_clinic',
    classifierVersion: 'aesthetic_clinic@v1',
  };

  it('run event records duration + reason', () => {
    trackClassifierRun({
      ...baseProps,
      reason: 'onboarding',
      durationMs: 120,
      tookLlmFallback: false,
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.classifier.run',
      expect.objectContaining({ reason: 'onboarding', durationMs: 120 })
    );
  });

  it('failed event carries errorCode + errorMessage', () => {
    trackClassifierFailed({
      ...baseProps,
      reason: 'force',
      durationMs: 200,
      tookLlmFallback: false,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'boom',
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.classifier.failed',
      expect.objectContaining({
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'boom',
      })
    );
  });

  it('disagreement_detected event flattens axes', () => {
    trackClassifierDisagreementDetected({
      ...baseProps,
      axes: ['marketPosition'],
      classifierConfidence: 0.85,
    });
    expect(trackOrgEventMock).toHaveBeenCalledWith(
      orgId,
      'claire.classifier.disagreement_detected',
      expect.objectContaining({
        axes: 'marketPosition',
        axisCount: 1,
        classifierConfidence: 0.85,
      })
    );
  });
});
