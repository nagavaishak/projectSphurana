import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE modules, not the feature barrels: the barrels' re-exports are
// live getters under Vite SSR and cannot be redefined.
import * as listServicesForOrgModule from '../../../organization-services/services/list-services-for-org/list-services-for-org.service.js';
import { ErrorCodes, FeatureError } from '../../../shared/index.js';
import * as computeRecommendationModule from '../../recommendation-engine/compute-recommendation.js';
import * as adContextClassifyModule from '../../triggers/ad-context-classify/ad-context-classify.trigger.js';
import * as getBusinessProfileModule from '../get-business-profile/get-business-profile.service.js';

// Stub the collaborators with restored spies. The key regression this guards
// (ENG-313): the missing/stub branches must ENQUEUE classification onto the
// worker queue (triggerAdContextClassify) and must NOT run it in-process — the
// old detached `classifyBusiness(db,…)` call orphaned a connection across a
// 10–40s LLM call and surfaced as UNSAFE_TRANSACTION.
let mockGetBusinessProfile: MockInstance;
let mockTriggerAdContextClassify: MockInstance;
let mockListServicesForOrg: ReturnType<typeof vi.spyOn>;
let mockComputeRecommendation: MockInstance;

import { getAdCreationContext } from './get-ad-creation-context.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const mockDb = {} as never;

describe('getAdCreationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListServicesForOrg = vi.spyOn(
      listServicesForOrgModule,
      'listServicesForOrg'
    );
    mockGetBusinessProfile = (
      vi.spyOn(
        getBusinessProfileModule,
        'getBusinessProfile'
      ) as unknown as MockInstance
    ).mockReturnValue(undefined);
    mockComputeRecommendation = (
      vi.spyOn(
        computeRecommendationModule,
        'computeRecommendation'
      ) as unknown as MockInstance
    ).mockReturnValue(undefined);
    mockTriggerAdContextClassify = vi.spyOn(
      adContextClassifyModule,
      'triggerAdContextClassify'
    ) as unknown as MockInstance;
    mockTriggerAdContextClassify.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockListServicesForOrg.mockRestore();
    mockGetBusinessProfile.mockRestore();
    mockComputeRecommendation.mockRestore();
    mockTriggerAdContextClassify.mockRestore();
  });

  it('enqueues classification (does not run it in-process) when the profile is missing', async () => {
    mockGetBusinessProfile.mockResolvedValueOnce({
      success: false,
      error: new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Business profile not found'
      ),
    });

    const result = await getAdCreationContext(mockDb, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.profileState).toBe('missing');
    expect(mockTriggerAdContextClassify).toHaveBeenCalledWith(ORG_ID);
  });

  it('enqueues classification when the profile is a pending stub', async () => {
    mockGetBusinessProfile.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'profile-1',
        organizationId: ORG_ID,
        inputHash: 'pending',
        classifierVersion: 'pending',
        marketPosition: 'unknown',
        disagreement: null,
      },
    });

    const result = await getAdCreationContext(mockDb, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profileState).toBe('pending');
      expect(result.data.needsMarketPosition).toBe(true);
    }
    expect(mockTriggerAdContextClassify).toHaveBeenCalledWith(ORG_ID);
  });

  it('does NOT enqueue classification for a fresh profile', async () => {
    mockGetBusinessProfile.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'profile-1',
        organizationId: ORG_ID,
        inputHash: 'real-hash',
        classifierVersion: 'v1',
        marketPosition: 'mid',
        disagreement: null,
      },
    });
    mockListServicesForOrg.mockResolvedValueOnce({ success: true, data: [] });
    mockComputeRecommendation.mockReturnValueOnce({
      topService: null,
      alternatives: [],
    });

    const result = await getAdCreationContext(mockDb, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.profileState).toBe('fresh');
    expect(mockTriggerAdContextClassify).not.toHaveBeenCalled();
  });
});
