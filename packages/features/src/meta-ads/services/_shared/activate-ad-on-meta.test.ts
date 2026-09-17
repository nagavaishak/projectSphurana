import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { activateAdOnMeta } from './activate-ad-on-meta.js';

const createMockMetaService = () => ({
  updateCampaign: vi.fn().mockResolvedValue(undefined),
  updateAdSet: vi.fn().mockResolvedValue(undefined),
  updateAd: vi.fn().mockResolvedValue(undefined),
  getAdPermalink: vi.fn(),
  // Read-back (ADR-005): activateAdOnMeta verifies the resulting state.
  getAd: vi.fn().mockResolvedValue({
    id: 'ad-001',
    name: 'Test ad',
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
  }),
  getCampaign: vi.fn().mockResolvedValue({
    id: 'campaign-001',
    name: 'Test campaign',
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    objective: 'OUTCOME_LEADS',
  }),
});

describe('activateAdOnMeta', () => {
  let metaService: ReturnType<typeof createMockMetaService>;

  const input = {
    metaCampaignId: 'campaign-001',
    metaAdSetId: 'adset-001',
    metaAdId: 'ad-001',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    metaService = createMockMetaService();
  });

  it('activates campaign, ad set, and ad in order', async () => {
    metaService.getAdPermalink.mockResolvedValueOnce('https://fb.com/ad/123');

    await activateAdOnMeta(metaService as never, input);

    expect(metaService.updateCampaign).toHaveBeenCalledWith('campaign-001', {
      status: 'ACTIVE',
    });
    expect(metaService.updateAdSet).toHaveBeenCalledWith('adset-001', {
      status: 'ACTIVE',
    });
    expect(metaService.updateAd).toHaveBeenCalledWith('ad-001', {
      status: 'ACTIVE',
    });
  });

  it('returns permalink on success', async () => {
    metaService.getAdPermalink.mockResolvedValueOnce('https://fb.com/ad/123');

    const result = await activateAdOnMeta(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permalink).toBe('https://fb.com/ad/123');
    }
  });

  it('returns null permalink when not available', async () => {
    metaService.getAdPermalink.mockRejectedValueOnce(new Error('Not found'));

    const result = await activateAdOnMeta(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.permalink).toBeNull();
    }
  });

  it('returns the read-back launch state (live) after activation', async () => {
    metaService.getAdPermalink.mockResolvedValueOnce('https://fb.com/ad/123');

    const result = await activateAdOnMeta(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.launch.state).toBe('live');
      expect(result.data.launch.adEffectiveStatus).toBe('ACTIVE');
    }
  });

  it('reports live_but_campaign_paused when the campaign stays paused', async () => {
    metaService.getAdPermalink.mockResolvedValueOnce(null);
    metaService.getAd.mockResolvedValueOnce({
      id: 'ad-001',
      name: 'Test ad',
      status: 'ACTIVE',
      effectiveStatus: 'CAMPAIGN_PAUSED',
    });
    metaService.getCampaign.mockResolvedValueOnce({
      id: 'campaign-001',
      name: 'Test campaign',
      status: 'PAUSED',
      effectiveStatus: 'PAUSED',
      objective: 'OUTCOME_LEADS',
    });

    const result = await activateAdOnMeta(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.launch.state).toBe('live_but_campaign_paused');
    }
  });

  it('reports unverified (never live) when the read-back fails', async () => {
    metaService.getAdPermalink.mockResolvedValueOnce(null);
    metaService.getAd.mockRejectedValueOnce(new Error('Meta 500'));
    metaService.getCampaign.mockRejectedValueOnce(new Error('Meta 500'));

    const result = await activateAdOnMeta(metaService as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.launch.state).toBe('unverified');
      expect(result.data.launch.adEffectiveStatus).toBeNull();
    }
  });

  it('propagates campaign activation failure', async () => {
    metaService.updateCampaign.mockRejectedValueOnce(
      new Error('Campaign activation failed')
    );

    await expect(activateAdOnMeta(metaService as never, input)).rejects.toThrow(
      'Campaign activation failed'
    );
  });

  it('propagates ad activation failure', async () => {
    metaService.updateAd.mockRejectedValueOnce(
      new Error('Ad activation failed')
    );

    await expect(activateAdOnMeta(metaService as never, input)).rejects.toThrow(
      'Ad activation failed'
    );
  });
});
