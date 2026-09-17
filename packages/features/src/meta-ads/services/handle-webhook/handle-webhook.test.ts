import { createHmac } from 'node:crypto';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import {
  handleWebhook,
  verifyWebhookChallenge,
} from './handle-webhook.service.js';

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockReturnThis(),
  query: {
    metaAd: { findFirst: vi.fn() },
    metaAdsIntegration: { findFirst: vi.fn() },
  },
};

const APP_SECRET = 'test-app-secret';

// Helper to create valid signature
const createSignature = (rawBody: string) => {
  const hash = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  return `sha256=${hash}`;
};

describe('handleWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.delete.mockReturnValue(mockDb);
  });

  it('processes ad deletion successfully', async () => {
    const payload = {
      object: 'ad_account',
      entry: [
        {
          id: 'act_123',
          time: 1704067200,
          changes: [
            {
              field: 'ads',
              value: {
                ad_id: 'meta-ad-001',
                account_id: 'act_123',
                deleted: true,
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    const mockAd = {
      id: 'ad-123',
      metaAdId: 'meta-ad-001',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(1);
      expect(result.data.synced).toBe(1);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('processes campaign change successfully (no local sync needed)', async () => {
    // Campaigns are no longer stored locally - handleCampaignChange just logs and returns true
    const payload = {
      object: 'ad_account',
      entry: [
        {
          id: 'act_123',
          time: 1704067200,
          changes: [
            {
              field: 'campaigns',
              value: {
                campaign_id: 'meta-campaign-001',
                account_id: 'act_123',
                effective_status: 'PAUSED',
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
    if (result.success) {
      // Campaign changes are counted as processed and synced (handleCampaignChange returns true)
      expect(result.data.processed).toBe(1);
      expect(result.data.synced).toBe(1);
    }
    // No local DB update for campaigns
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('processes campaign deletion successfully (no local sync needed)', async () => {
    const payload = {
      object: 'ad_account',
      entry: [
        {
          id: 'act_123',
          time: 1704067200,
          changes: [
            {
              field: 'campaigns',
              value: {
                campaign_id: 'meta-campaign-001',
                account_id: 'act_123',
                deleted: true,
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(1);
      expect(result.data.synced).toBe(1);
    }
    // No local DB operations for campaigns
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('counts ad change as processed even when ad is unknown', async () => {
    // The ad change schema parses successfully so processed is incremented,
    // but syncAdFromMeta returns false because the ad is not in the DB
    const payload = {
      object: 'ad_account',
      entry: [
        {
          id: 'act_123',
          time: 1704067200,
          changes: [
            {
              field: 'ads',
              value: {
                ad_id: 'unknown-ad',
                account_id: 'act_123',
                effective_status: 'ACTIVE',
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
    if (result.success) {
      // processed is incremented because the change value parses successfully
      expect(result.data.processed).toBe(1);
      // synced stays 0 because ad not found in DB
      expect(result.data.synced).toBe(0);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('counts ad deletion as processed but not synced when ad is unknown', async () => {
    const payload = {
      object: 'ad_account',
      entry: [
        {
          id: 'act_123',
          time: 1704067200,
          changes: [
            {
              field: 'ads',
              value: {
                ad_id: 'unknown-ad',
                account_id: 'act_123',
                deleted: true,
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(1);
      expect(result.data.synced).toBe(0);
    }
  });

  it('processes multiple changes in one webhook', async () => {
    const payload = {
      object: 'ad_account',
      entry: [
        {
          id: 'act_123',
          time: 1704067200,
          changes: [
            {
              field: 'ads',
              value: {
                ad_id: 'meta-ad-001',
                account_id: 'act_123',
                deleted: true,
              },
            },
            {
              field: 'ads',
              value: {
                ad_id: 'meta-ad-002',
                account_id: 'act_123',
                deleted: true,
              },
            },
            {
              field: 'campaigns',
              value: {
                campaign_id: 'meta-campaign-001',
                account_id: 'act_123',
                effective_status: 'ACTIVE',
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    mockDb.query.metaAd.findFirst
      .mockResolvedValueOnce({ id: 'ad-1', metaAdId: 'meta-ad-001' })
      .mockResolvedValueOnce({ id: 'ad-2', metaAdId: 'meta-ad-002' });

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(3);
    }
  });

  it('returns UNAUTHORIZED for invalid signature', async () => {
    const payload = {
      object: 'ad_account',
      entry: [] as { id: string; time: number; changes: unknown[] }[],
    };
    const rawBody = JSON.stringify(payload);
    const invalidSignature = 'sha256=invalid-signature';

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature: invalidSignature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(result.error.message).toContain('signature');
    }
  });

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await handleWebhook(
      mockDb as never,
      { payload: null as never, signature: 'sig', rawBody: 'body' },
      APP_SECRET
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('ignores unknown change fields', async () => {
    const payload = {
      object: 'ad_account',
      entry: [
        {
          id: 'act_123',
          time: 1704067200,
          changes: [
            {
              field: 'unknown_field',
              value: { some: 'data' },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(0);
    }
  });

  it('continues processing after individual change error', async () => {
    const payload = {
      object: 'ad_account',
      entry: [
        {
          id: 'act_123',
          time: 1704067200,
          changes: [
            {
              field: 'ads',
              value: {
                ad_id: 'meta-ad-001',
                account_id: 'act_123',
                deleted: true,
              },
            },
            {
              field: 'ads',
              value: {
                ad_id: 'meta-ad-002',
                account_id: 'act_123',
                deleted: true,
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    // First ad lookup throws, second succeeds
    mockDb.query.metaAd.findFirst
      .mockRejectedValueOnce(new Error('DB Error'))
      .mockResolvedValueOnce({ id: 'ad-2', metaAdId: 'meta-ad-002' });

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
    if (result.success) {
      // First change: processed++ runs (=1), then handleAdChange throws, caught by outer try/catch
      // Second change: processed++ runs (=2), handleAdChange succeeds, synced++ (=1)
      expect(result.data.processed).toBe(2);
      expect(result.data.synced).toBe(1);
    }
  });

  it('handles signature without sha256= prefix', async () => {
    const payload = {
      object: 'ad_account',
      entry: [] as { id: string; time: number; changes: unknown[] }[],
    };
    const rawBody = JSON.stringify(payload);
    const hash = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature: hash, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
  });

  it('processes adsets and ad_account changes as processed', async () => {
    const payload = {
      object: 'ad_account',
      entry: [
        {
          id: 'act_123',
          time: 1704067200,
          changes: [
            {
              field: 'adsets',
              value: { adset_id: 'adset-001' },
            },
            {
              field: 'ad_account',
              value: { account_id: 'act_123' },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = createSignature(rawBody);

    const result = await handleWebhook(
      mockDb as never,
      { payload, signature, rawBody },
      APP_SECRET
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(2);
      expect(result.data.synced).toBe(0);
    }
  });
});

describe('verifyWebhookChallenge', () => {
  const VERIFY_TOKEN = 'my-verify-token';

  it('returns challenge when mode and token match', () => {
    const result = verifyWebhookChallenge(
      'subscribe',
      VERIFY_TOKEN,
      'challenge-string-123',
      VERIFY_TOKEN
    );

    expect(result).toBe('challenge-string-123');
  });

  it('returns null when mode is not subscribe', () => {
    const result = verifyWebhookChallenge(
      'unsubscribe',
      VERIFY_TOKEN,
      'challenge-123',
      VERIFY_TOKEN
    );

    expect(result).toBeNull();
  });

  it('returns null when token does not match', () => {
    const result = verifyWebhookChallenge(
      'subscribe',
      'wrong-token',
      'challenge-123',
      VERIFY_TOKEN
    );

    expect(result).toBeNull();
  });

  it('returns null when both mode and token are wrong', () => {
    const result = verifyWebhookChallenge(
      'wrong-mode',
      'wrong-token',
      'challenge-123',
      VERIFY_TOKEN
    );

    expect(result).toBeNull();
  });
});
