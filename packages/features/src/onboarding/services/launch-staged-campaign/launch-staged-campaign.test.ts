import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as syncLeadFormToMetaModule from '../../../lead-forms/services/sync-lead-form-to-meta/sync-lead-form-to-meta.service.js';
import * as createAdModule from '../../../meta-ads/services/create-ad/create-ad.service.js';
import * as publishAdModule from '../../../meta-ads/services/publish-ad/publish-ad.service.js';
import * as createCampaignModule from '../../../meta-campaigns/services/create-campaign/create-campaign.service.js';
import { ErrorCodes, FeatureError } from '../../../shared/index.js';
import { launchStagedCampaign } from './launch-staged-campaign.service.js';

// Restored `vi.spyOn`s, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file. Spies are installed at run
// time (load-order independent) and restored after each test.
const mocks = {
  createCampaign: undefined as unknown as MockInstance,
  syncLeadFormToMeta: undefined as unknown as MockInstance,
  createAd: undefined as unknown as MockInstance,
  publishAd: undefined as unknown as MockInstance,
};

const mockDb = createMockDatabase();

const stagedCampaign = {
  name: 'Intro Facial Offer — 4 Jul 2026',
  dailyBudgetCents: 1000,
  targeting: {
    locationId: 'loc-1',
    location: 'Pelham Street, Dublin',
    distanceKm: 20,
  },
  leadFormId: 'lf-1',
  nurtureChannel: 'messenger' as const,
  launchProgress: 'not_started' as const,
};

const baseSession = {
  id: 'sess-1',
  userId: 'user-1',
  organizationId: 'org-1',
  offerId: 'offer-1',
  selectedServiceId: 'svc-1',
  selectedGraphicIds: ['g-1', 'g-2'],
  selectedVideoId: 'v-1',
  stagedCampaign,
  metaCampaignId: null,
  launchedAt: null,
};

const configuredIntegration = {
  id: 'int-1',
  configurationStatus: 'configured',
  tokenStatus: 'valid',
};

/** The last stagedCampaign value persisted via db.update().set(). */
const lastPersistedStaged = () => {
  const calls = mockDb.set.mock.calls.filter(
    (c: unknown[][]) => (c[0] as Record<string, unknown>).stagedCampaign
  );
  return (
    calls.length > 0
      ? (calls[calls.length - 1][0] as Record<string, unknown>).stagedCampaign
      : undefined
  ) as { launchProgress?: string; adIds?: string[] } | undefined;
};

describe('launchStagedCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();

    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValue(
      configuredIntegration
    );

    mocks.createCampaign = vi
      .spyOn(createCampaignModule, 'createCampaign')
      .mockResolvedValue({
        success: true,
        data: {
          metaCampaignId: 'mc-1',
          metaAdSetId: 'as-1',
          followUpType: 'lead_form',
        },
      } as never);
    mocks.syncLeadFormToMeta = vi
      .spyOn(syncLeadFormToMetaModule, 'syncLeadFormToMeta')
      .mockResolvedValue({
        success: true,
        data: { id: 'lf-1', status: 'synced' },
      } as never);
    mocks.createAd = vi
      .spyOn(createAdModule, 'createAd')
      .mockResolvedValueOnce({ success: true, data: { id: 'ad-1' } } as never)
      .mockResolvedValueOnce({ success: true, data: { id: 'ad-2' } } as never)
      .mockResolvedValueOnce({ success: true, data: { id: 'ad-3' } } as never);
    mocks.publishAd = vi.spyOn(publishAdModule, 'publishAd').mockResolvedValue({
      success: true,
      data: { ad: { id: 'ad-x', status: 'active' } },
    } as never);
  });

  afterEach(() => {
    mocks.createCampaign.mockRestore();
    mocks.syncLeadFormToMeta.mockRestore();
    mocks.createAd.mockRestore();
    mocks.publishAd.mockRestore();
  });

  it('runs the full chain: campaign → lead form sync → 3 draft ads → publish all', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(baseSession);

    const result = await launchStagedCampaign(mockDb as never, {
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaCampaignId).toBe('mc-1');
      expect(result.data.adIds).toEqual(['ad-1', 'ad-2', 'ad-3']);
      expect(result.data.launchProgress).toBe('launched');
    }

    // Step a — lead-form campaign with the staged values
    expect(mocks.createCampaign).toHaveBeenCalledTimes(1);
    expect(mocks.createCampaign.mock.calls[0][1]).toMatchObject({
      organizationId: 'org-1',
      name: stagedCampaign.name,
      objective: 'OUTCOME_LEADS',
      dailyBudget: 1000,
      followUpType: 'lead_form',
      leadFormId: 'lf-1',
      // Geo is the staged BRANCH; createCampaign resolves its coordinates.
      // Nothing here sends latitude/longitude, and nothing falls back to a
      // country — the `countries: ['IE']` last resort this replaced pointed
      // US and UK orgs' first campaign at Ireland.
      locationId: 'loc-1',
      targeting: expect.objectContaining({ distanceKm: 20 }),
    });
    expect(mocks.createCampaign.mock.calls[0][1].targeting).not.toHaveProperty(
      'countries'
    );

    // Step b
    expect(mocks.syncLeadFormToMeta).toHaveBeenCalledWith(expect.anything(), {
      leadFormId: 'lf-1',
    });

    // Step c — 2 graphics + 1 video, all lead_form drafts in the campaign
    expect(mocks.createAd).toHaveBeenCalledTimes(3);
    expect(mocks.createAd.mock.calls[0][1]).toMatchObject({
      metaCampaignId: 'mc-1',
      graphicId: 'g-1',
      followUpType: 'lead_form',
      leadFormId: 'lf-1',
      serviceIds: ['svc-1'],
    });
    expect(mocks.createAd.mock.calls[1][1]).toMatchObject({
      graphicId: 'g-2',
    });
    expect(mocks.createAd.mock.calls[2][1]).toMatchObject({ videoId: 'v-1' });

    // Step d — every draft published
    expect(mocks.publishAd).toHaveBeenCalledTimes(3);
    expect(mocks.publishAd).toHaveBeenCalledWith(expect.anything(), {
      adId: 'ad-1',
      organizationId: 'org-1',
    });

    expect(lastPersistedStaged()?.launchProgress).toBe('launched');
  });

  it("RESUMES from 'campaign_created' without calling createCampaign again", async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      metaCampaignId: 'mc-1',
      stagedCampaign: {
        ...stagedCampaign,
        launchProgress: 'campaign_created' as const,
      },
    });

    const result = await launchStagedCampaign(mockDb as never, {
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    expect(mocks.syncLeadFormToMeta).toHaveBeenCalledTimes(1);
    expect(mocks.createAd).toHaveBeenCalledTimes(3);
    expect(mocks.publishAd).toHaveBeenCalledTimes(3);
  });

  it("resumes mid-'create_ads' from persisted adIds without duplicating drafts", async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      metaCampaignId: 'mc-1',
      stagedCampaign: {
        ...stagedCampaign,
        launchProgress: 'lead_form_synced' as const,
        adIds: ['ad-1'],
      },
    });
    // NOT `mockReset()`: on a `vi.spyOn` handle vitest restores the ORIGINAL
    // implementation, so uncovered calls would hit the real `createAd`.
    // Re-install a fresh spy instead to drop the queued once-values.
    mocks.createAd.mockRestore();
    mocks.createAd = vi
      .spyOn(createAdModule, 'createAd')
      .mockResolvedValue({
        success: true,
        data: { id: 'ad-unexpected' },
      } as never)
      .mockResolvedValueOnce({ success: true, data: { id: 'ad-2' } } as never)
      .mockResolvedValueOnce({ success: true, data: { id: 'ad-3' } } as never);

    const result = await launchStagedCampaign(mockDb as never, {
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adIds).toEqual(['ad-1', 'ad-2', 'ad-3']);
    }
    // Only the 2 missing creatives (g-2 + video) were created.
    expect(mocks.createAd).toHaveBeenCalledTimes(2);
    expect(mocks.createAd.mock.calls[0][1]).toMatchObject({
      graphicId: 'g-2',
    });
    expect(mocks.createAd.mock.calls[1][1]).toMatchObject({ videoId: 'v-1' });
  });

  it('persists the progress reached when a step fails, and reports the step', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(baseSession);
    mocks.syncLeadFormToMeta.mockResolvedValueOnce({
      success: false,
      error: new FeatureError('META_SYNC_FAILED', 'Meta rejected the form'),
    });

    const result = await launchStagedCampaign(mockDb as never, {
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('META_SYNC_FAILED');
      expect(result.error.details?.step).toBe('sync_lead_form');
    }

    // Step a completed and was persisted BEFORE the failure — a retry resumes.
    expect(lastPersistedStaged()?.launchProgress).toBe('campaign_created');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ metaCampaignId: 'mc-1' })
    );
    expect(mocks.createAd).not.toHaveBeenCalled();
    expect(mocks.publishAd).not.toHaveBeenCalled();
  });

  it('treats an already-published ad (INVALID_AD_STATE) as done when resuming step d', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      metaCampaignId: 'mc-1',
      stagedCampaign: {
        ...stagedCampaign,
        launchProgress: 'ads_created' as const,
        adIds: ['ad-1', 'ad-2', 'ad-3'],
      },
    });
    mocks.publishAd.mockResolvedValueOnce({
      success: false,
      error: new FeatureError('INVALID_AD_STATE', 'not a draft'),
    });

    const result = await launchStagedCampaign(mockDb as never, {
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    expect(mocks.createAd).not.toHaveBeenCalled();
    expect(mocks.publishAd).toHaveBeenCalledTimes(3);
  });

  it('returns CONFLICT when nothing was staged', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      stagedCampaign: null,
    });

    await expectResult(
      launchStagedCampaign(mockDb as never, { userId: 'user-1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when creative picks are incomplete', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce({
      ...baseSession,
      selectedGraphicIds: ['g-1'],
    });

    await expectResult(
      launchStagedCampaign(mockDb as never, { userId: 'user-1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it('returns CONFLICT when the Meta integration is not configured', async () => {
    mockDb.query.onboardingSession.findFirst.mockResolvedValueOnce(baseSession);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int-1',
      configurationStatus: 'pending_selection',
      tokenStatus: 'valid',
    });

    await expectResult(
      launchStagedCampaign(mockDb as never, { userId: 'user-1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });
});
