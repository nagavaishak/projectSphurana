import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import {
  localStatusForLaunchState,
  verifyAdLaunchState,
} from './verify-ad-launch-state.service.js';

const createMockMetaService = () => ({
  getAd: vi.fn(),
  getCampaign: vi.fn(),
});

const input = { metaAdId: 'meta-ad-1', metaCampaignId: 'meta-campaign-1' };

const adWith = (effectiveStatus: string) => ({
  id: 'meta-ad-1',
  name: 'Test ad',
  status: 'ACTIVE',
  effectiveStatus,
});

const campaignWith = (effectiveStatus: string) => ({
  id: 'meta-campaign-1',
  name: 'Test campaign',
  status: effectiveStatus,
  effectiveStatus,
  objective: 'OUTCOME_LEADS',
});

describe('verifyAdLaunchState', () => {
  let metaService: ReturnType<typeof createMockMetaService>;

  beforeEach(() => {
    vi.clearAllMocks();
    metaService = createMockMetaService();
  });

  it('returns VALIDATION_ERROR for missing ids', async () => {
    const result = await verifyAdLaunchState(metaService as never, {
      metaAdId: '',
      metaCampaignId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(metaService.getAd).not.toHaveBeenCalled();
  });

  it('returns live when ad ACTIVE and campaign ACTIVE', async () => {
    metaService.getAd.mockResolvedValueOnce(adWith('ACTIVE'));
    metaService.getCampaign.mockResolvedValueOnce(campaignWith('ACTIVE'));

    const result = await verifyAdLaunchState(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('live');
      expect(result.data.adEffectiveStatus).toBe('ACTIVE');
      expect(result.data.campaignEffectiveStatus).toBe('ACTIVE');
    }
  });

  it('returns live_but_campaign_paused when ad ACTIVE but campaign PAUSED (#105)', async () => {
    metaService.getAd.mockResolvedValueOnce(adWith('ACTIVE'));
    metaService.getCampaign.mockResolvedValueOnce(campaignWith('PAUSED'));

    const result = await verifyAdLaunchState(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('live_but_campaign_paused');
      expect(result.data.detail).toContain('PAUSED');
    }
  });

  it('returns live_but_campaign_paused when ad reports CAMPAIGN_PAUSED', async () => {
    metaService.getAd.mockResolvedValueOnce(adWith('CAMPAIGN_PAUSED'));
    metaService.getCampaign.mockResolvedValueOnce(campaignWith('PAUSED'));

    const result = await verifyAdLaunchState(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('live_but_campaign_paused');
    }
  });

  it('returns pending_review for PENDING_REVIEW and never claims live', async () => {
    metaService.getAd.mockResolvedValueOnce(adWith('PENDING_REVIEW'));
    metaService.getCampaign.mockResolvedValueOnce(campaignWith('ACTIVE'));

    const result = await verifyAdLaunchState(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('pending_review');
      expect(result.data.detail).not.toContain('is live');
      expect(result.data.detail).toContain('not live yet');
    }
  });

  it('returns paused_at_meta for PAUSED and ADSET_PAUSED', async () => {
    for (const status of ['PAUSED', 'ADSET_PAUSED', 'ARCHIVED']) {
      metaService.getAd.mockResolvedValueOnce(adWith(status));
      metaService.getCampaign.mockResolvedValueOnce(campaignWith('ACTIVE'));
      const result = await verifyAdLaunchState(metaService as never, input);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.state).toBe('paused_at_meta');
    }
  });

  it('returns rejected for DISAPPROVED', async () => {
    metaService.getAd.mockResolvedValueOnce(adWith('DISAPPROVED'));
    metaService.getCampaign.mockResolvedValueOnce(campaignWith('ACTIVE'));

    const result = await verifyAdLaunchState(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.state).toBe('rejected');
  });

  it('returns failed for WITH_ISSUES and unknown statuses', async () => {
    for (const status of ['WITH_ISSUES', 'DELETED', 'SOMETHING_NEW']) {
      metaService.getAd.mockResolvedValueOnce(adWith(status));
      metaService.getCampaign.mockResolvedValueOnce(campaignWith('ACTIVE'));
      const result = await verifyAdLaunchState(metaService as never, input);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.state).toBe('failed');
    }
  });

  it('returns unverified (never live) when the ad read-back throws', async () => {
    metaService.getAd.mockRejectedValueOnce(new Error('Meta 500'));
    metaService.getCampaign.mockResolvedValueOnce(campaignWith('ACTIVE'));

    const result = await verifyAdLaunchState(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('unverified');
      expect(result.data.adEffectiveStatus).toBeNull();
      expect(result.data.detail).toContain('must not be reported as live');
    }
  });

  it('still resolves the ad state when only the campaign read fails', async () => {
    metaService.getAd.mockResolvedValueOnce(adWith('ACTIVE'));
    metaService.getCampaign.mockRejectedValueOnce(new Error('Meta 500'));

    const result = await verifyAdLaunchState(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      // Without a campaign read we cannot prove the campaign is paused; the
      // ad's own effective_status (which folds in CAMPAIGN_PAUSED) governs.
      expect(result.data.state).toBe('live');
      expect(result.data.campaignEffectiveStatus).toBeNull();
    }
  });

  it('returns unverified when Meta returns no status at all', async () => {
    metaService.getAd.mockResolvedValueOnce({
      id: 'meta-ad-1',
      name: 'Test ad',
      status: undefined,
      effectiveStatus: undefined,
    });
    metaService.getCampaign.mockResolvedValueOnce(campaignWith('ACTIVE'));

    const result = await verifyAdLaunchState(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.state).toBe('unverified');
  });
});

describe('localStatusForLaunchState', () => {
  it('maps every union member to a truthful local status', () => {
    expect(localStatusForLaunchState('live')).toBe('active');
    expect(localStatusForLaunchState('live_but_campaign_paused')).toBe(
      'paused'
    );
    expect(localStatusForLaunchState('paused_at_meta')).toBe('paused');
    expect(localStatusForLaunchState('pending_review')).toBe('pending');
    expect(localStatusForLaunchState('unverified')).toBe('pending');
    expect(localStatusForLaunchState('rejected')).toBe('rejected');
    expect(localStatusForLaunchState('failed')).toBe('error');
  });
});
