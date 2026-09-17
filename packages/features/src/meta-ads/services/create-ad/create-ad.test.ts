import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import { createAd } from './create-ad.service.js';

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  // `.delete(table).where(cond)` — used by the replaceCampaignDrafts path.
  delete: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
  query: {
    video: { findFirst: vi.fn() },
    asset: { findFirst: vi.fn() },
    graphic: { findFirst: vi.fn() },
    organizationService: { findMany: vi.fn() },
    // lead_form campaigns store their form at the campaign level; the service
    // inherits it via metaCampaignConfig when the ad didn't pick its own.
    metaCampaignConfig: { findFirst: vi.fn() },
  },
};

describe('createAd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.query.organizationService.findMany.mockResolvedValue([
      { id: 'service-1' },
    ]);
  });

  const validInput = {
    metaCampaignId: 'campaign-123',
    videoId: 'video-456',
    organizationId: 'org-789',
    name: 'Summer Sale Ad',
    headline: 'Buy Now!',
    primaryText: 'Get 50% off',
    callToAction: 'SHOP_NOW' as const,
    destinationUrl: 'https://example.com',
    targeting: { countries: ['US'] },
    serviceIds: ['service-1'],
  };

  it('creates ad with valid input', async () => {
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
      title: 'Video Title',
    };
    const mockAd = {
      id: 'ad-001',
      ...validInput,
      status: 'draft',
    };

    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Summer Sale Ad');
      expect(result.data.status).toBe('draft');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing metaCampaignId', async () => {
    const result = await createAd(mockDb as never, {
      ...validInput,
      metaCampaignId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.video.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing videoId', async () => {
    const result = await createAd(mockDb as never, {
      ...validInput,
      videoId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing name', async () => {
    const result = await createAd(mockDb as never, {
      ...validInput,
      name: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for invalid destination URL', async () => {
    const result = await createAd(mockDb as never, {
      ...validInput,
      destinationUrl: 'not-a-url',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VIDEO_NOT_FOUND when video does not exist in either table', async () => {
    // Video not in video table
    mockDb.query.video.findFirst.mockResolvedValueOnce(null);
    // Video not in asset table either
    mockDb.query.asset.findFirst.mockResolvedValueOnce(null);

    const result = await createAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.VIDEO_NOT_FOUND);
    }
  });

  it('creates a draft ad even when the video is still rendering (readiness is enforced at launch, not draft creation)', async () => {
    const mockVideo = {
      id: 'video-456',
      status: 'processing',
    };
    const mockAd = {
      id: 'ad-001',
      ...validInput,
      status: 'draft',
    };
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('accepts targeting without geo (optional targeting override)', async () => {
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
    };
    const mockAd = {
      id: 'ad-001',
      ...validInput,
      targeting: { ageMin: 25, ageMax: 45 },
      status: 'draft',
    };

    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, {
      ...validInput,
      targeting: { ageMin: 25, ageMax: 45 },
    });

    expect(result.success).toBe(true);
  });

  it('creates ad with lat/lng city targeting', async () => {
    const cityInput = {
      ...validInput,
      targeting: {
        location: 'Dublin, Ireland',
        latitude: 53.3498,
        longitude: -6.2603,
        distanceKm: 25,
      },
    };
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
    };
    const mockAd = {
      id: 'ad-001',
      ...cityInput,
      status: 'draft',
    };

    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, cityInput);

    expect(result.success).toBe(true);
  });

  it('returns VALIDATION_ERROR for empty serviceIds', async () => {
    const result = await createAd(mockDb as never, {
      ...validInput,
      serviceIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.video.findFirst).not.toHaveBeenCalled();
  });

  it('rejects duplicate service IDs before the junction table can raise a unique-constraint error', async () => {
    // `meta_ad_service` has a unique(meta_ad_id, service_id) constraint. A
    // duplicate passed through here used to reach the bulk insert, throw, and
    // become an INTERNAL_ERROR / HTTP 500 in the assistant draft-ad flow.
    const result = await createAd(mockDb as never, {
      ...validInput,
      serviceIds: ['service-1', 'service-1'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toBe('Service IDs must be unique');
    }
    expect(mockDb.query.video.findFirst).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects service IDs that are missing from the active organization before writing a draft', async () => {
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);

    const result = await createAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toBe('One or more services not found');
    }
    expect(mockDb.query.video.findFirst).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates ad without optional fields', async () => {
    const minimalInput = {
      metaCampaignId: 'campaign-123',
      videoId: 'video-456',
      organizationId: 'org-789',
      name: 'Minimal Ad',
      targeting: { countries: ['US'] },
      serviceIds: ['service-1'],
    };
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
    };
    const mockAd = {
      id: 'ad-001',
      ...minimalInput,
      status: 'draft',
    };

    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, minimalInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Minimal Ad');
    }
  });

  it('creates ad with custom targeting', async () => {
    const inputWithTargeting = {
      ...validInput,
      targeting: {
        ageMin: 25,
        ageMax: 45,
        countries: ['US', 'CA'],
      },
    };
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
    };
    const mockAd = {
      id: 'ad-001',
      ...inputWithTargeting,
      status: 'draft',
    };

    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, inputWithTargeting);

    expect(result.success).toBe(true);
  });

  it('creates ad with followUpType and chatbot config', async () => {
    const chatbotInput = {
      ...validInput,
      followUpType: 'chatbot' as const,
      conversionDestination: 'messenger' as const,
    };
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
    };
    const mockAd = {
      id: 'ad-001',
      ...chatbotInput,
      status: 'draft',
    };

    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, chatbotInput);

    expect(result.success).toBe(true);
  });

  it('creates ad with ad placement and page override', async () => {
    const inputWithPlacement = {
      ...validInput,
      adPlacement: 'both' as const,
      metaAdsPageId: 'page-override-123',
    };
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
    };
    const mockAd = {
      id: 'ad-001',
      ...inputWithPlacement,
      status: 'draft',
    };

    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, inputWithPlacement);

    expect(result.success).toBe(true);
  });

  it("clears the campaign's existing draft ads before inserting when replaceCampaignDrafts is true", async () => {
    const mockVideo = { id: 'video-456', status: 'ready' };
    const mockAd = { id: 'ad-002', ...validInput, status: 'draft' };

    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, {
      ...validInput,
      replaceCampaignDrafts: true,
    });

    expect(result.success).toBe(true);
    // A delete was issued (to clear prior drafts) and an insert followed.
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('does NOT delete existing drafts when replaceCampaignDrafts is unset (default one-off create)', async () => {
    const mockVideo = { id: 'video-456', status: 'ready' };
    const mockAd = { id: 'ad-003', ...validInput, status: 'draft' };

    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('creates ad when video is found in asset table', async () => {
    const mockAsset = {
      id: 'video-456',
      type: 'video',
      name: 'Uploaded Video',
    };
    const mockAd = {
      id: 'ad-001',
      ...validInput,
      status: 'draft',
    };

    // Not in video table
    mockDb.query.video.findFirst.mockResolvedValueOnce(null);
    // Found in asset table
    mockDb.query.asset.findFirst.mockResolvedValueOnce(mockAsset);
    mockDb.returning.mockResolvedValueOnce([mockAd]);

    const result = await createAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Summer Sale Ad');
    }
  });
});
