import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { finalizeAd } from './finalize-ad.service.js';

const mockIntegrations = {
  mockWaitForVideoReady: vi.mocked(mockMetaAdsService.waitForVideoReady),
  mockCreateAdCreative: vi.mocked(mockMetaAdsService.createAdCreative),
  mockCreateAdCreativeFromImage: vi.mocked(
    mockMetaAdsService.createAdCreativeFromImage
  ),
  mockCreateAd: vi.mocked(mockMetaAdsService.createAd),
  mockUpdateCampaign: vi.mocked(mockMetaAdsService.updateCampaign),
  mockUpdateAdSet: vi.mocked(mockMetaAdsService.updateAdSet),
  mockUpdateAd: vi.mocked(mockMetaAdsService.updateAd),
  mockGetPageId: vi.mocked(mockMetaAdsService.getPageId),
  mockGetAdAccountId: vi.mocked(mockMetaAdsService.getAdAccountId),
  mockGetCreative: vi.mocked(mockMetaAdsService.getCreative),
  mockGetAdPermalink: vi.mocked(mockMetaAdsService.getAdPermalink),
  mockUploadImage: vi.mocked(mockMetaAdsService.uploadImage),
  mockGetCampaign: vi.mocked(mockMetaAdsService.getCampaign),
  mockGetAd: vi.mocked(mockMetaAdsService.getAd),
  mockListAdSets: vi.mocked(mockMetaAdsService.listAdSets),
  mockDecryptCredentials: vi.mocked(decryptCredentials),
};

const createMockDb = () => ({
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
  query: {
    metaAd: { findFirst: vi.fn() },
    metaAdsIntegration: { findFirst: vi.fn() },
    metaCampaignConfig: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    leadForm: { findFirst: vi.fn() },
    video: { findFirst: vi.fn() },
    asset: { findFirst: vi.fn() },
  },
});

describe('finalizeAd', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockIntegrations.mockGetPageId.mockReturnValue('page_456');
    mockIntegrations.mockGetAdAccountId.mockReturnValue('act_123');
    mockIntegrations.mockGetCreative.mockResolvedValue({
      id: 'creative-001',
      status: 'ACTIVE',
    });
    mockIntegrations.mockGetAdPermalink.mockResolvedValue(
      'https://fb.com/ad/123'
    );
    mockIntegrations.mockUploadImage.mockResolvedValue({
      imageHash: 'hash_123',
    });
  });

  const adId = 'ad-001';
  const organizationId = 'org-789';

  const validAdRecord = {
    id: adId,
    name: 'Test Ad',
    metaVideoId: 'meta-video-001',
    metaCampaignId: 'meta-campaign-001',
    metaAdSetId: 'meta-adset-001',
    callToAction: 'LEARN_MORE',
    headline: 'Test Headline',
    primaryText: 'Test Body',
    description: 'Test Description',
    destinationUrl: 'https://example.com',
    followUpType: 'lead_form',
    leadFormId: null,
    conversionDestination: null,
    adPlacement: 'facebook',
    metaAdsPageId: null,
  };

  const validIntegration = {
    id: 'int-123',
    encryptedCredentials: 'encrypted-creds',
    adAccountId: 'act_123',
    configurationStatus: 'configured',
    isActive: true,
    defaultPage: {
      id: 'default-page',
      pageId: 'page_456',
      pageName: 'Test Page',
      linkedInstagramAccountId: null,
      linkedInstagramUsername: null,
      defaultAdAccountId: 'act_123',
      defaultAdAccountName: 'Test Account',
      defaultAdAccountCurrency: 'USD',
    },
    pages: [
      {
        id: 'default-page',
        pageId: 'page_456',
        pageName: 'Test Page',
        linkedInstagramAccountId: null,
        linkedInstagramUsername: null,
        defaultAdAccountId: 'act_123',
        defaultAdAccountName: 'Test Account',
        defaultAdAccountCurrency: 'USD',
      },
    ],
    availableAdAccounts: null,
  };

  it('finalizes ad successfully', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(validAdRecord);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.example.com/thumb.jpg',
    });
    mockIntegrations.mockCreateAdCreative.mockResolvedValueOnce('creative-001');
    mockIntegrations.mockCreateAd.mockResolvedValueOnce('meta-ad-001');
    // The read-back (ADR-005): Meta reports the ad ACTIVE inside an ACTIVE
    // campaign, so the verified launch state is `live` → status 'active',
    // metaStatus 'ACTIVE'. The service persists what Meta SAYS, no longer a
    // hardcoded literal.
    mockIntegrations.mockGetAd.mockResolvedValue({
      id: 'meta-ad-001',
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
    });
    mockIntegrations.mockGetCampaign.mockResolvedValue({
      id: 'meta-campaign-001',
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
      objective: 'OUTCOME_LEADS',
    });

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockIntegrations.mockCreateAdCreative).toHaveBeenCalled();
    expect(mockIntegrations.mockCreateAd).toHaveBeenCalled();
    expect(mockIntegrations.mockUpdateCampaign).toHaveBeenCalledWith(
      'meta-campaign-001',
      { status: 'ACTIVE' }
    );
    expect(mockIntegrations.mockUpdateAdSet).toHaveBeenCalledWith(
      'meta-adset-001',
      { status: 'ACTIVE' }
    );
    // Verify ad record was updated with the READ-BACK success status.
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metaAdId: 'meta-ad-001',
        metaCreativeId: 'creative-001',
        status: 'active',
        metaStatus: 'ACTIVE',
        syncError: null,
      })
    );
  });

  it('returns early when ad record not found', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockIntegrations.mockWaitForVideoReady).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns early when ad has no metaVideoId', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      metaVideoId: null,
    });

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockIntegrations.mockWaitForVideoReady).not.toHaveBeenCalled();
  });

  it('returns early when ad has no metaCampaignId', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      metaCampaignId: null,
    });

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockIntegrations.mockWaitForVideoReady).not.toHaveBeenCalled();
  });

  it('sets error status when integration not configured', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(validAdRecord);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        syncError: expect.stringContaining('not configured'),
      })
    );
  });

  it('sets error status when credential decryption fails', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(validAdRecord);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockImplementationOnce(() => {
      throw new Error('Decryption failed');
    });

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        syncError: expect.stringContaining('decrypt'),
      })
    );
  });

  it('sets error status when video is not ready on Meta', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(validAdRecord);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValueOnce({
      isReady: false,
      errorMessage: 'Video encoding failed',
    });

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        syncError: 'Video encoding failed',
      })
    );
    expect(mockIntegrations.mockCreateAdCreative).not.toHaveBeenCalled();
  });

  it('records Lead Generation ToS error with user-friendly message', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(validAdRecord);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.example.com/thumb.jpg',
    });
    mockIntegrations.mockCreateAdCreative.mockRejectedValueOnce(
      new Error('Lead Generation Terms of Service must be accepted')
    );

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        syncError: expect.stringContaining('Lead Generation Terms of Service'),
      })
    );
  });

  it('uses Meta lead form ID (not local ID) for lead form ads', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      leadFormId: 'local-lead-form-001',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.example.com/thumb.jpg',
    });
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce({
      metaFormId: 'meta-lead-form-99999',
    });
    mockIntegrations.mockCreateAdCreative.mockResolvedValueOnce('creative-lf');
    mockIntegrations.mockCreateAd.mockResolvedValueOnce('meta-ad-lf');

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockIntegrations.mockCreateAdCreative).toHaveBeenCalledWith(
      expect.objectContaining({
        objectStorySpec: expect.objectContaining({
          videoData: expect.objectContaining({
            callToAction: expect.objectContaining({
              value: expect.objectContaining({
                leadGenFormId: 'meta-lead-form-99999',
              }),
            }),
          }),
        }),
      })
    );
  });

  it('sets error when lead form has no metaFormId', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      leadFormId: 'local-lead-form-001',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.example.com/thumb.jpg',
    });
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce({
      metaFormId: null,
    });

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        syncError: expect.stringContaining(
          'Lead form has not been synced to Meta'
        ),
      })
    );
    expect(mockIntegrations.mockCreateAdCreative).not.toHaveBeenCalled();
  });

  it('uses chatbot CTA for chatbot follow-up type', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      followUpType: 'chatbot',
      conversionDestination: 'whatsapp',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_ENGAGEMENT',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.example.com/thumb.jpg',
    });
    mockIntegrations.mockCreateAdCreative.mockResolvedValueOnce('creative-002');
    mockIntegrations.mockCreateAd.mockResolvedValueOnce('meta-ad-002');

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockIntegrations.mockCreateAdCreative).toHaveBeenCalledWith(
      expect.objectContaining({
        objectStorySpec: expect.objectContaining({
          videoData: expect.objectContaining({
            callToAction: expect.objectContaining({
              type: 'WHATSAPP_MESSAGE',
              value: expect.objectContaining({
                appDestination: 'WHATSAPP',
              }),
            }),
          }),
        }),
      })
    );
  });

  it('does not add asset_feed_spec for OUTCOME_LEADS chatbot ads', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      followUpType: 'chatbot',
      conversionDestination: 'messenger',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_LEADS',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.example.com/thumb.jpg',
    });
    mockIntegrations.mockCreateAdCreative.mockResolvedValueOnce(
      'creative-leads'
    );
    mockIntegrations.mockCreateAd.mockResolvedValueOnce('meta-ad-leads');

    await finalizeAd(mockDb as never, adId, organizationId);

    // Should NOT have asset_feed_spec (single-destination MESSENGER)
    expect(mockIntegrations.mockCreateAdCreative).toHaveBeenCalledWith(
      expect.objectContaining({
        assetFeedSpec: undefined,
      })
    );
    // Should have appDestination: 'MESSENGER' on the CTA
    expect(mockIntegrations.mockCreateAdCreative).toHaveBeenCalledWith(
      expect.objectContaining({
        objectStorySpec: expect.objectContaining({
          videoData: expect.objectContaining({
            callToAction: expect.objectContaining({
              type: 'MESSAGE_PAGE',
              value: expect.objectContaining({
                appDestination: 'MESSENGER',
              }),
            }),
          }),
        }),
      })
    );
    // degrees_of_freedom_spec should still be present (for creative features opt-out)
    expect(mockIntegrations.mockCreateAdCreative).toHaveBeenCalledWith(
      expect.objectContaining({
        degreesOfFreedomSpec: expect.objectContaining({
          creative_features_spec: expect.any(Object),
        }),
      })
    );
  });

  it('adds asset_feed_spec for OUTCOME_ENGAGEMENT chatbot ads', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      followUpType: 'chatbot',
      conversionDestination: 'messenger',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_ENGAGEMENT',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.example.com/thumb.jpg',
    });
    mockIntegrations.mockCreateAdCreative.mockResolvedValueOnce(
      'creative-engage'
    );
    mockIntegrations.mockCreateAd.mockResolvedValueOnce('meta-ad-engage');

    await finalizeAd(mockDb as never, adId, organizationId);

    // Should have multi-destination asset_feed_spec
    expect(mockIntegrations.mockCreateAdCreative).toHaveBeenCalledWith(
      expect.objectContaining({
        assetFeedSpec: expect.objectContaining({
          optimization_type: 'DOF_MESSAGING_DESTINATION',
          call_to_actions: expect.arrayContaining([
            expect.objectContaining({
              type: 'MESSAGE_PAGE',
              value: expect.objectContaining({
                app_destination: 'MESSENGER',
              }),
            }),
            expect.objectContaining({
              type: 'INSTAGRAM_MESSAGE',
              value: expect.objectContaining({
                app_destination: 'INSTAGRAM_DIRECT',
              }),
            }),
          ]),
        }),
      })
    );
  });

  it('sets appDestination on image creative CTA for OUTCOME_LEADS chatbot', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      followUpType: 'chatbot',
      conversionDestination: 'messenger',
      metaVideoId: null,
      metaImageHash: 'img-hash-001',
      videoId: null,
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_LEADS',
    });
    mockIntegrations.mockCreateAdCreativeFromImage.mockResolvedValueOnce(
      'creative-img-leads'
    );
    mockIntegrations.mockCreateAd.mockResolvedValueOnce('meta-ad-img-leads');

    await finalizeAd(mockDb as never, adId, organizationId);

    // Image creative should have appDestination on CTA
    expect(mockIntegrations.mockCreateAdCreativeFromImage).toHaveBeenCalledWith(
      expect.objectContaining({
        objectStorySpec: expect.objectContaining({
          linkData: expect.objectContaining({
            callToAction: expect.objectContaining({
              type: 'MESSAGE_PAGE',
              value: expect.objectContaining({
                appDestination: 'MESSENGER',
              }),
            }),
          }),
        }),
        assetFeedSpec: undefined,
      })
    );
  });

  it('resolves destination URL from organization when ad has none', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      destinationUrl: null,
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockWaitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.example.com/thumb.jpg',
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      websiteUrl: 'https://org-website.com',
    });
    mockIntegrations.mockCreateAdCreative.mockResolvedValueOnce('creative-003');
    mockIntegrations.mockCreateAd.mockResolvedValueOnce('meta-ad-003');

    await finalizeAd(mockDb as never, adId, organizationId);

    expect(mockIntegrations.mockCreateAdCreative).toHaveBeenCalledWith(
      expect.objectContaining({
        objectStorySpec: expect.objectContaining({
          videoData: expect.objectContaining({
            callToAction: expect.objectContaining({
              value: expect.objectContaining({
                link: 'https://org-website.com',
              }),
            }),
          }),
        }),
      })
    );
  });

  // Regression: a click-to-Messenger ad set whose ad row has the WRONG
  // followUpType ('lead_form') must STILL get a messaging (MESSAGE_PAGE)
  // creative — driven by the ad set's destination_type, not followUpType.
  // Previously this produced a BOOK_NOW traffic CTA, which Meta rejected for
  // image link_data as incompatible with the objective (100/1487891).
  it('builds a messaging image creative on a MESSENGER ad set even when followUpType is lead_form', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...validAdRecord,
      followUpType: 'lead_form',
      conversionDestination: null,
      leadFormId: null,
      callToAction: 'BOOK_NOW',
      destinationUrl: null,
      metaVideoId: null,
      metaImageHash: 'img-hash-msg',
      videoId: null,
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      validIntegration
    );
    mockIntegrations.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
    });
    mockIntegrations.mockGetCampaign.mockResolvedValueOnce({
      id: 'meta-campaign-001',
      objective: 'OUTCOME_ENGAGEMENT',
    });
    // The ad set is a single-destination click-to-Messenger ad set.
    mockIntegrations.mockListAdSets.mockResolvedValueOnce([
      { id: 'meta-adset-001', destinationType: 'MESSENGER' },
    ]);
    mockIntegrations.mockCreateAdCreativeFromImage.mockResolvedValueOnce(
      'creative-img-msg'
    );
    mockIntegrations.mockCreateAd.mockResolvedValueOnce('meta-ad-img-msg');

    await finalizeAd(mockDb as never, adId, organizationId);

    const imageCall =
      mockIntegrations.mockCreateAdCreativeFromImage.mock.calls[0]?.[0];
    const cta = imageCall?.objectStorySpec?.linkData?.callToAction;
    // Messaging CTA, NOT the traffic BOOK_NOW.
    expect(cta?.type).toBe('MESSAGE_PAGE');
    // The CTA value must NOT carry a website link (that makes it a traffic
    // creative). Single-destination engagement: no appDestination either.
    expect(cta?.value?.link).toBeUndefined();
    // Single MESSENGER destination → no multi-destination asset_feed_spec.
    expect(imageCall?.assetFeedSpec).toBeUndefined();
  });
});
