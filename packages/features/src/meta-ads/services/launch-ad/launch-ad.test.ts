import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { CampaignErrorCodes } from '../../../meta-campaigns/models/index.js';
import { ErrorCodes } from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import * as ensureCampaignConfigModule from '../ensure-campaign-config/index.js';

import { launchAd } from './launch-ad.service.js';

// Imported-campaign backfill is its own unit (see ensure-campaign-config.test).
// Here it's a no-op so the existing config-resolution sequences are unchanged.
//
// This used to be a bare `vi.mock('../ensure-campaign-config/index.js', ...)`
// exporting only `ensureCampaignConfig`. Under `pool: 'threads'` +
// `isolate: false` that factory persists on the shared worker module graph and
// DELETES the module's other exports (`backfillCampaignConfigs`, both schemas)
// for every later test file. A RESTORED spy leaves the real module intact
// outside this file — see the MAINTENANCE RULE in vite.config.ts.
let ensureCampaignConfigSpy: { mockRestore: () => void } | undefined;

const mockIntegrations = {
  mockGetCampaign: vi.mocked(mockMetaAdsService.getCampaign),
  mockCreateCampaign: vi.mocked(mockMetaAdsService.createCampaign),
  mockCreateAdSet: vi.mocked(mockMetaAdsService.createAdSet),
  mockUploadVideo: vi.mocked(mockMetaAdsService.uploadVideo),
  mockWaitForVideoReady: vi.mocked(mockMetaAdsService.waitForVideoReady),
  mockCreateAdCreative: vi.mocked(mockMetaAdsService.createAdCreative),
  mockCreateAd: vi.mocked(mockMetaAdsService.createAd),
  mockUpdateCampaign: vi.mocked(mockMetaAdsService.updateCampaign),
  mockUpdateAdSet: vi.mocked(mockMetaAdsService.updateAdSet),
  mockGetPageId: vi.mocked(mockMetaAdsService.getPageId),
  mockListAdSets: vi.mocked(mockMetaAdsService.listAdSets),
  mockGetPageInfo: vi.mocked(mockMetaAdsService.getPageInfo),
};

const {
  mockUploadVideo,
  mockCreateAdSet,
  mockListAdSets,
  mockGetPageInfo: _mockGetPageInfo,
  mockWaitForVideoReady: _mockWaitForVideoReady,
  mockCreateAdCreative: _mockCreateAdCreative,
  mockCreateAd: _mockCreateAd,
} = mockIntegrations;

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  query: {
    metaAdsIntegration: { findFirst: vi.fn() },
    metaCampaignConfig: { findFirst: vi.fn() },
    video: { findFirst: vi.fn() },
    asset: { findFirst: vi.fn() },
    graphic: { findFirst: vi.fn() },
    metaAd: { findFirst: vi.fn() },
    whatsappAccount: { findFirst: vi.fn() },
  },
};

describe('launchAd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `vi.clearAllMocks()` only `mockClear()`s — it wipes call history but keeps
    // BOTH the persistent implementation and any unconsumed `mock*Once` queue.
    // Tests here queue several `mockResolvedValueOnce` values and some bail out
    // before consuming them all, so leftovers bled into whichever test ran next
    // (this file failed under `--sequence.shuffle`). Fully reset the programmed
    // mocks so every test starts from the same state.
    for (const table of Object.values(mockDb.query)) {
      table.findFirst.mockReset();
    }
    mockDb.returning.mockReset();
    ensureCampaignConfigSpy = vi
      .spyOn(ensureCampaignConfigModule, 'ensureCampaignConfig')
      .mockResolvedValue({ success: true, data: { created: false } });
    mockIntegrations.mockGetCampaign.mockResolvedValue({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_LEADS',
    });
    mockIntegrations.mockCreateCampaign.mockResolvedValue('meta-campaign-001');
    mockIntegrations.mockCreateAdSet.mockResolvedValue('meta-adset-001');
    mockIntegrations.mockUploadVideo.mockResolvedValue({
      videoId: 'meta-video-001',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValue({ isReady: true });
    mockIntegrations.mockCreateAdCreative.mockResolvedValue(
      'meta-creative-001'
    );
    mockIntegrations.mockCreateAd.mockResolvedValue('meta-ad-001');
    mockIntegrations.mockUpdateCampaign.mockResolvedValue(undefined);
    mockIntegrations.mockUpdateAdSet.mockResolvedValue(undefined);
    mockIntegrations.mockGetPageId.mockReturnValue('page_456');
    mockIntegrations.mockListAdSets.mockResolvedValue([
      { id: 'meta-adset-001', effectiveStatus: 'ACTIVE' },
    ]);
    mockIntegrations.mockGetPageInfo.mockResolvedValue({
      whatsapp_business_account: { id: 'waba_123' },
    });
    vi.mocked(mockMetaAdsService.hasPaymentMethod).mockResolvedValue(true);
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'mock-token',
      adAccountId: 'act_123',
      pageId: 'page_456',
    });
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.values.mockReturnValue(mockDb);
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
  });

  afterEach(() => {
    ensureCampaignConfigSpy?.mockRestore();
    ensureCampaignConfigSpy = undefined;
  });

  const validInput = {
    metaCampaignId: 'meta-campaign-001',
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

  it('launches ad with existing campaign', async () => {
    const mockIntegration = {
      id: 'int-123',
      encryptedCredentials: 'encrypted-creds',
      adAccountId: 'act_123',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage: {
        pageId: 'page_456',
        pageName: 'Test Page',
        defaultAdAccountId: 'act_123',
        defaultAdAccountName: 'Test Account',
        defaultAdAccountCurrency: 'USD',
      },
    };
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
      blobUrl: 'https://storage.example.com/video.mp4',
      title: 'Video Title',
    };
    const mockAd = {
      id: 'ad-001',
      status: 'launching',
    };
    const mockUpdatedAd = {
      id: 'ad-001',
      metaVideoId: 'meta-video-001',
      status: 'launching',
    };

    // First metaCampaignConfig call: ad account resolution (line 72 of service)
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaAdSetId: 'meta-adset-001',
      followUpType: 'chatbot',
      adAccountId: 'act_123',
    });
    // Second metaCampaignConfig call: resolveAdSet
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaAdSetId: 'meta-adset-001',
      followUpType: 'chatbot',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning
      .mockResolvedValueOnce([mockAd]) // Insert ad
      .mockResolvedValueOnce([mockUpdatedAd]); // Update ad with metaVideoId

    const result = await launchAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ad.metaVideoId).toBe('meta-video-001');
      expect(result.data.metaCampaignId).toBe('meta-campaign-001');
      expect(result.data.metaAdSetId).toBe('meta-adset-001');
      expect(mockUploadVideo).toHaveBeenCalled();
    }
  });

  it('returns META_NOT_CONFIGURED when no integration exists', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await launchAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
    }
  });

  it('returns VIDEO_NOT_FOUND when video does not exist', async () => {
    const mockIntegration = {
      id: 'int-123',
      encryptedCredentials: 'encrypted-creds',
      adAccountId: 'act_123',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage: {
        pageId: 'page_456',
        pageName: 'Test Page',
        defaultAdAccountId: 'act_123',
        defaultAdAccountName: 'Test Account',
        defaultAdAccountCurrency: 'USD',
      },
    };

    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(null);
    mockDb.query.asset.findFirst.mockResolvedValueOnce(null);

    const result = await launchAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.VIDEO_NOT_FOUND);
    }
  });

  it('returns VIDEO_NOT_READY when video is processing', async () => {
    const mockIntegration = {
      id: 'int-123',
      encryptedCredentials: 'encrypted-creds',
      adAccountId: 'act_123',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage: {
        pageId: 'page_456',
        pageName: 'Test Page',
        defaultAdAccountId: 'act_123',
        defaultAdAccountName: 'Test Account',
        defaultAdAccountCurrency: 'USD',
      },
    };
    const mockVideo = {
      id: 'video-456',
      status: 'processing',
      blobUrl: 'https://storage.example.com/video.mp4',
    };

    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);

    const result = await launchAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.VIDEO_NOT_READY);
    }
  });

  it('returns VIDEO_NOT_READY when video has no blobUrl', async () => {
    const mockIntegration = {
      id: 'int-123',
      encryptedCredentials: 'encrypted-creds',
      adAccountId: 'act_123',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage: {
        pageId: 'page_456',
        pageName: 'Test Page',
        defaultAdAccountId: 'act_123',
        defaultAdAccountName: 'Test Account',
        defaultAdAccountCurrency: 'USD',
      },
    };
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
      blobUrl: null, // No URL
    };

    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);

    const result = await launchAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.VIDEO_NOT_READY);
    }
  });

  it('returns VALIDATION_ERROR when metaCampaignId is missing', async () => {
    const invalidInput = {
      videoId: 'video-456',
      organizationId: 'org-789',
      name: 'Ad Name',
      callToAction: 'SHOP_NOW' as const,
      serviceIds: ['service-1'],
    };

    const result = await launchAd(mockDb as never, invalidInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns META_AD_CREATE_FAILED when video upload to Meta fails', async () => {
    const mockIntegration = {
      id: 'int-123',
      encryptedCredentials: 'encrypted-creds',
      adAccountId: 'act_123',
      configurationStatus: 'configured',
      isActive: true,
      defaultPage: {
        pageId: 'page_456',
        pageName: 'Test Page',
        defaultAdAccountId: 'act_123',
        defaultAdAccountName: 'Test Account',
        defaultAdAccountCurrency: 'USD',
      },
    };
    const mockVideo = {
      id: 'video-456',
      status: 'ready',
      blobUrl: 'https://storage.example.com/video.mp4',
    };

    // First metaCampaignConfig call: ad account resolution (line 72 of service)
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaAdSetId: 'meta-adset-001',
      followUpType: 'chatbot',
      adAccountId: 'act_123',
    });
    // Second metaCampaignConfig call: resolveAdSet
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaAdSetId: 'meta-adset-001',
      followUpType: 'chatbot',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);
    mockDb.returning.mockResolvedValueOnce([{ id: 'ad-001' }]); // Insert ad

    // Mock video upload failure
    mockUploadVideo.mockRejectedValueOnce(new Error('Video upload failed'));

    const result = await launchAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.META_AD_CREATE_FAILED);
    }
  });

  it('returns VALIDATION_ERROR for missing required fields', async () => {
    const invalidInput = {
      metaCampaignId: 'campaign-123',
      videoId: 'video-456',
      organizationId: '',
      name: 'Ad Name',
      callToAction: 'SHOP_NOW' as const,
    };

    const result = await launchAd(mockDb as never, invalidInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  // ===== ENG-178/179: per-ad messaging destinations =====
  // These cover the chatbot + destinations branch that routes through
  // findOrCreateAdSet and the WhatsApp preflight validator. The legacy
  // path (no destinations) is exercised by the tests above.

  const mockIntegrationWithPage = {
    id: 'int-123',
    encryptedCredentials: 'encrypted-creds',
    adAccountId: 'act_123',
    configurationStatus: 'configured',
    isActive: true,
    defaultPage: {
      id: 'internal-page-1',
      pageId: 'page_456',
      pageName: 'Test Page',
      defaultAdAccountId: 'act_123',
      defaultAdAccountName: 'Test Account',
      defaultAdAccountCurrency: 'USD',
    },
  };

  const mockReadyVideo = {
    id: 'video-456',
    status: 'ready',
    blobUrl: 'https://storage.example.com/video.mp4',
    title: 'Video Title',
  };

  const chatbotInput = {
    ...validInput,
    followUpType: 'chatbot' as const,
    callToAction: 'WHATSAPP_MESSAGE' as const,
  };

  const stubWhatsAppAccount = (
    overrides: Partial<{
      wabaId: string;
      tokenStatus: 'valid' | 'needs_reconnect';
      phoneNumber: string;
    }> = {}
  ) =>
    mockDb.query.whatsappAccount.findFirst.mockResolvedValue({
      phoneNumber: overrides.phoneNumber ?? '+1234567890',
      phoneNumberId: 'phone-id-1',
      wabaId: overrides.wabaId ?? 'waba_123',
      tokenStatus: overrides.tokenStatus ?? 'valid',
      encryptedCredentials: 'encrypted-wa-creds',
    });

  /**
   * Stub the Graph API `GET /{pageId}?fields=whatsapp_business_account`
   * call used by validateWhatsAppDestinationPrerequisites. Pass a wabaId to
   * simulate a linked Page, or `null` for an unlinked Page.
   */
  const stubPageWhatsAppLinkage = (linkedWabaId: string | null) => {
    const body = linkedWabaId
      ? { whatsapp_business_account: { id: linkedWabaId } }
      : {};
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response);
  };

  // The OUTCOME_ENGAGEMENT objective is valid for messaging campaigns.
  // findOrCreateAdSet queries metaCampaignConfig for targeting.
  const setupChatbotCampaignConfigs = () => {
    // 1st: ad account resolution in launch-ad
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaAdSetId: 'meta-adset-001',
      followUpType: 'chatbot',
      adAccountId: 'act_123',
    });
    // 2nd: targeting lookup inside findOrCreateAdSet
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      targeting: { countries: ['US'] },
    });
  };

  it('reuses an existing ad set when destination_type already matches', async () => {
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_ENGAGEMENT',
      name: 'Chatbot Campaign',
    });
    mockListAdSets.mockResolvedValueOnce([
      {
        id: 'meta-adset-existing-wa',
        destinationType: 'WHATSAPP',
        effectiveStatus: 'ACTIVE',
      },
    ]);

    setupChatbotCampaignConfigs();
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegrationWithPage
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockReadyVideo);
    stubWhatsAppAccount();
    stubPageWhatsAppLinkage('waba_123');
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'ad-001', status: 'launching' }])
      .mockResolvedValueOnce([{ id: 'ad-001', metaVideoId: 'meta-video-001' }]);

    const result = await launchAd(mockDb as never, {
      ...chatbotInput,
      destinations: ['whatsapp'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaAdSetId).toBe('meta-adset-existing-wa');
    }
    expect(mockCreateAdSet).not.toHaveBeenCalled();
  });

  it('creates a new ad set with destination_type=WHATSAPP when none match', async () => {
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_LEADS',
      name: 'Chatbot Campaign',
    });
    mockListAdSets.mockResolvedValueOnce([
      {
        id: 'meta-adset-messenger',
        destinationType: 'MESSENGER',
        effectiveStatus: 'ACTIVE',
      },
    ]);
    mockCreateAdSet.mockResolvedValueOnce('meta-adset-new-wa');

    setupChatbotCampaignConfigs();
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegrationWithPage
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockReadyVideo);
    stubWhatsAppAccount();
    stubPageWhatsAppLinkage('waba_123');
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'ad-001', status: 'launching' }])
      .mockResolvedValueOnce([{ id: 'ad-001', metaVideoId: 'meta-video-001' }]);

    const result = await launchAd(mockDb as never, {
      ...chatbotInput,
      destinations: ['whatsapp'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaAdSetId).toBe('meta-adset-new-wa');
    }
    expect(mockCreateAdSet).toHaveBeenCalledTimes(1);
    const createdAdSet = mockCreateAdSet.mock.calls[0]?.[0];
    expect(createdAdSet?.destinationType).toBe('WHATSAPP');
    expect(createdAdSet?.promotedObject?.whatsappPhoneNumber).toBe(
      '+1234567890'
    );
  });

  it('returns META_WHATSAPP_DISCONNECTED when WhatsApp is requested but no account is connected', async () => {
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_LEADS',
      name: 'Chatbot Campaign',
    });

    // ad-account resolution only — we bail before findOrCreateAdSet runs
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaAdSetId: 'meta-adset-001',
      followUpType: 'chatbot',
      adAccountId: 'act_123',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegrationWithPage
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockReadyVideo);
    // No whatsappAccount → lookup returns META_WHATSAPP_DISCONNECTED
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await launchAd(mockDb as never, {
      ...chatbotInput,
      destinations: ['whatsapp'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.META_WHATSAPP_DISCONNECTED);
    }
    expect(mockCreateAdSet).not.toHaveBeenCalled();
    expect(mockUploadVideo).not.toHaveBeenCalled();
  });

  it('returns META_WHATSAPP_FREE_NUMBER_INELIGIBLE when the connected WA number is a Meta-provided 555 free number', async () => {
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_LEADS',
      name: 'Chatbot Campaign',
    });
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaAdSetId: 'meta-adset-001',
      followUpType: 'chatbot',
      adAccountId: 'act_123',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegrationWithPage
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockReadyVideo);
    stubWhatsAppAccount({ phoneNumber: '+15551234567' });

    const result = await launchAd(mockDb as never, {
      ...chatbotInput,
      destinations: ['whatsapp'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(
        AdErrorCodes.META_WHATSAPP_FREE_NUMBER_INELIGIBLE
      );
    }
    expect(mockCreateAdSet).not.toHaveBeenCalled();
  });

  it('returns META_WHATSAPP_PHONE_NOT_LINKED when the selected page is not linked to the WABA', async () => {
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_LEADS',
      name: 'Chatbot Campaign',
    });
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaAdSetId: 'meta-adset-001',
      followUpType: 'chatbot',
      adAccountId: 'act_123',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegrationWithPage
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockReadyVideo);
    stubWhatsAppAccount();
    // Preflight uses the WhatsApp OAuth token to query the Page's
    // whatsapp_business_account field directly — return an empty body.
    stubPageWhatsAppLinkage(null);

    const result = await launchAd(mockDb as never, {
      ...chatbotInput,
      destinations: ['whatsapp'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(
        AdErrorCodes.META_WHATSAPP_PHONE_NOT_LINKED
      );
    }
    expect(mockCreateAdSet).not.toHaveBeenCalled();
  });

  it('creates a new Messenger ad set when the campaign only has WhatsApp ad sets', async () => {
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_LEADS',
      name: 'Chatbot Campaign',
    });
    mockListAdSets.mockResolvedValueOnce([
      {
        id: 'meta-adset-wa',
        destinationType: 'WHATSAPP',
        effectiveStatus: 'ACTIVE',
      },
    ]);
    mockCreateAdSet.mockResolvedValueOnce('meta-adset-new-messenger');

    setupChatbotCampaignConfigs();
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegrationWithPage
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockReadyVideo);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'ad-001', status: 'launching' }])
      .mockResolvedValueOnce([{ id: 'ad-001', metaVideoId: 'meta-video-001' }]);

    const result = await launchAd(mockDb as never, {
      ...chatbotInput,
      destinations: ['messenger'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaAdSetId).toBe('meta-adset-new-messenger');
    }
    expect(mockCreateAdSet).toHaveBeenCalledTimes(1);
    expect(mockCreateAdSet.mock.calls[0]?.[0]?.destinationType).toBe(
      'MESSENGER'
    );
    // Messenger doesn't need a WhatsApp lookup
    expect(mockDb.query.whatsappAccount.findFirst).not.toHaveBeenCalled();
  });

  it('legacy path still works when destinations is omitted but conversionDestination=whatsapp', async () => {
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_LEADS',
      name: 'Chatbot Campaign',
    });
    mockListAdSets.mockResolvedValueOnce([
      {
        id: 'meta-adset-legacy-wa',
        destinationType: 'WHATSAPP',
        effectiveStatus: 'ACTIVE',
      },
    ]);

    setupChatbotCampaignConfigs();
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegrationWithPage
    );
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockReadyVideo);
    stubWhatsAppAccount();
    stubPageWhatsAppLinkage('waba_123');
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'ad-001', status: 'launching' }])
      .mockResolvedValueOnce([{ id: 'ad-001', metaVideoId: 'meta-video-001' }]);

    const result = await launchAd(mockDb as never, {
      ...chatbotInput,
      conversionDestination: 'whatsapp',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaAdSetId).toBe('meta-adset-legacy-wa');
    }
  });
});
