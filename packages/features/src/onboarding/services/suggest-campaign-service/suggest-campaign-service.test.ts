import { extractJson } from '@borradh-workspace/ai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE modules, not the organization-services / assistant barrels:
// barrel re-exports are live getters under Vite SSR and cannot be redefined.
import * as getContextModule from '../../../assistant/services/get-context/get-context.service.js';
import * as listServicesForOrgModule from '../../../organization-services/services/list-services-for-org/list-services-for-org.service.js';
import { ErrorCodes, FeatureError } from '../../../shared/index.js';
import { suggestCampaignService } from './suggest-campaign-service.service.js';

let mockGetAssistantContext: MockInstance;
let mockListServicesForOrg: MockInstance;

const mockSessionFindFirst = vi.fn();
const mockProfileFindFirst = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

const mockDb = {
  query: {
    onboardingSession: { findFirst: mockSessionFindFirst },
    businessProfile: { findFirst: mockProfileFindFirst },
  },
  update: mockUpdate,
} as never;

const baseSession = {
  id: 'sess_1',
  userId: 'user_1',
  organizationId: 'org_1',
};

const services = [
  { id: 'svc_1', name: 'HydraFacial', priceText: '€120 per session' },
  { id: 'svc_2', name: 'Microneedling', priceText: '€180 per session' },
  { id: 'svc_3', name: 'Consultation', priceText: null },
];

const okServices = (items: Array<Record<string, unknown>>) => ({
  success: true as const,
  data: items,
});

const okContext = {
  success: true as const,
  data: {
    name: 'Glow Clinic',
    address: null,
    businessType: 'aesthetic_clinic',
    businessTypeLabel: 'Aesthetic Clinic',
    brandVoice: [],
    targetAudienceDescription: null,
    credibilityLine: null,
    tagline: null,
    services: services.map((s) => s.name),
    serviceDetails: [],
  },
};

describe('suggestCampaignService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListServicesForOrg = vi.spyOn(
      listServicesForOrgModule,
      'listServicesForOrg'
    );
    mockSet.mockReturnValue({ where: mockWhere } as never);
    mockUpdate.mockReturnValue({ set: mockSet } as never);
    mockWhere.mockResolvedValue(undefined);
    mockSessionFindFirst.mockResolvedValue(baseSession);
    mockProfileFindFirst.mockResolvedValue(undefined);
    mockListServicesForOrg.mockResolvedValue(okServices(services));
    mockGetAssistantContext = vi
      .spyOn(getContextModule, 'getAssistantContext')
      .mockResolvedValue(okContext as never);
    vi.mocked(extractJson).mockResolvedValue({
      success: true,
      data: { serviceId: 'svc_1', reasons: ['Broad appeal'] },
    });
  });

  afterEach(() => {
    mockListServicesForOrg.mockRestore();
    mockGetAssistantContext.mockRestore();
  });

  it('takes the top rankedServices entry when a business profile exists', async () => {
    mockProfileFindFirst.mockResolvedValue({
      rankedServices: [
        {
          serviceId: 'svc_1',
          rank: 2,
          offerStrategyReason: 'Second-best retention fit',
          serviceRecommendationCopy: { title: 'B', body: 'Also fine.' },
        },
        {
          serviceId: 'svc_2',
          rank: 1,
          offerStrategyReason: 'Best retention fit and easy first yes',
          serviceRecommendationCopy: {
            title: 'Lead with Microneedling',
            body: 'Clients rebook it every 4-6 weeks.',
          },
        },
      ],
    });

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.serviceId).toBe('svc_2');
    expect(result.data.serviceName).toBe('Microneedling');
    expect(result.data.reasons).toEqual([
      'Best retention fit and easy first yes',
      'Clients rebook it every 4-6 weeks.',
    ]);
    expect(result.data.priceKnown).toBe(true);
    expect(result.data.priceCents).toBe(18000);

    // Ranked path never burns an AI call
    expect(vi.mocked(extractJson)).not.toHaveBeenCalled();

    // Choice is persisted onto the session
    expect(mockSet).toHaveBeenCalledWith({ selectedServiceId: 'svc_2' });
  });

  it('skips ranked entries whose service no longer exists', async () => {
    mockProfileFindFirst.mockResolvedValue({
      rankedServices: [
        {
          serviceId: 'svc_deleted',
          rank: 1,
          offerStrategyReason: 'Gone',
          serviceRecommendationCopy: { title: 'x', body: 'y' },
        },
        {
          serviceId: 'svc_1',
          rank: 2,
          offerStrategyReason: 'Still here',
          serviceRecommendationCopy: { title: 'a', body: 'b' },
        },
      ],
    });

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.serviceId).toBe('svc_1');
  });

  it('picks via one extractJson call when no ranking exists', async () => {
    vi.mocked(extractJson).mockResolvedValue({
      success: true,
      data: {
        serviceId: 'svc_1',
        reasons: ['Broad appeal', 'Clear €120 price'],
      },
    });

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.serviceId).toBe('svc_1');
    expect(result.data.serviceName).toBe('HydraFacial');
    expect(result.data.reasons).toEqual(['Broad appeal', 'Clear €120 price']);
    expect(result.data.priceKnown).toBe(true);
    expect(result.data.priceCents).toBe(12000);
    expect(vi.mocked(extractJson)).toHaveBeenCalledTimes(1);

    // The prompt lists the services so the model can only pick a real id
    const [prompt] = vi.mocked(extractJson).mock.calls[0] as [string];
    expect(prompt).toContain('svc_1');
    expect(prompt).toContain('Microneedling');

    expect(mockSet).toHaveBeenCalledWith({ selectedServiceId: 'svc_1' });
  });

  it('falls back to the first service when the AI pick fails', async () => {
    vi.mocked(extractJson).mockResolvedValue({
      success: false,
      data: null,
      error: 'Failed to parse JSON from response',
    });

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.serviceId).toBe('svc_1');
    expect(result.data.reasons).toHaveLength(1);
    expect(mockSet).toHaveBeenCalledWith({ selectedServiceId: 'svc_1' });
  });

  it('falls back when the AI returns an unknown serviceId', async () => {
    vi.mocked(extractJson).mockResolvedValue({
      success: true,
      data: { serviceId: 'svc_hallucinated', reasons: ['Made up'] },
    });

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.serviceId).toBe('svc_1');
  });

  it('reports priceKnown false when the service has no parseable price', async () => {
    vi.mocked(extractJson).mockResolvedValue({
      success: true,
      data: { serviceId: 'svc_3', reasons: ['Low barrier'] },
    });

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.serviceId).toBe('svc_3');
    expect(result.data.priceKnown).toBe(false);
    expect(result.data.priceCents).toBeUndefined();
  });

  it('returns CONFLICT when the organization has not been created yet', async () => {
    mockSessionFindFirst.mockResolvedValue({
      ...baseSession,
      organizationId: null,
    });

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(mockListServicesForOrg).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no onboarding session exists', async () => {
    mockSessionFindFirst.mockResolvedValue(undefined);

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns NOT_FOUND when the org has no services', async () => {
    mockListServicesForOrg.mockResolvedValue(okServices([]));

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(result.error.message).toMatch(/no services/i);
  });

  it('propagates a service-list failure', async () => {
    mockListServicesForOrg.mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.INTERNAL_ERROR, 'db exploded'),
    });

    const result = await suggestCampaignService(mockDb, { userId: 'user_1' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });

  it('returns VALIDATION_ERROR for a missing userId', async () => {
    const result = await suggestCampaignService(mockDb, { userId: '' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockSessionFindFirst).not.toHaveBeenCalled();
  });
});
