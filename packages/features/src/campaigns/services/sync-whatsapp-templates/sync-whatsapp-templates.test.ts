import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaApiError } from '@borradh-workspace/integrations';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockWhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { ErrorCodes } from '../../../shared/index.js';
import { syncWhatsappTemplates } from './sync-whatsapp-templates.service.js';

const mockListTemplates = vi.mocked(mockWhatsAppCloudService.listTemplates);

const account = {
  id: 'wa-1',
  organizationId: 'org-1',
  encryptedCredentials: 'encrypted-token',
  phoneNumberId: 'phone-1',
  wabaId: 'waba-1',
  isActive: true,
};

const cachedRow = {
  id: 'tpl-1',
  organizationId: 'org-1',
  name: 'june_offer',
  languageCode: 'en',
  category: 'MARKETING',
  status: 'approved',
  body: 'Hi {{1}}, {{2}} this month only.',
  metaTemplateId: 'meta-1',
};

describe('syncWhatsappTemplates', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    mockDb._resetMocks();
    vi.mocked(decryptCredentials).mockReset();
    mockListTemplates.mockReset();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await syncWhatsappTemplates(mockDb as never, {
      organizationId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('serves the cache without hitting Meta when not refreshing', async () => {
    mockDb.query.whatsappTemplate.findMany.mockResolvedValueOnce([cachedRow]);

    const result = await syncWhatsappTemplates(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.templates).toHaveLength(1);
      expect(result.data.synced).toBe(false);
    }
    expect(mockListTemplates).not.toHaveBeenCalled();
  });

  it('returns an empty cache read when no account is linked (no refresh)', async () => {
    mockDb.query.whatsappTemplate.findMany.mockResolvedValueOnce([]);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await syncWhatsappTemplates(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.templates).toHaveLength(0);
      expect(result.data.synced).toBe(false);
    }
  });

  it('refuses an explicit refresh when no account is linked', async () => {
    mockDb.query.whatsappTemplate.findMany.mockResolvedValueOnce([cachedRow]);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await syncWhatsappTemplates(mockDb as never, {
      organizationId: 'org-1',
      refresh: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CHANNEL_NOT_CONFIGURED');
    }
  });

  it('syncs from Meta and maps statuses on refresh', async () => {
    // First read = stale cache; second read = post-upsert state.
    mockDb.query.whatsappTemplate.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cachedRow]);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(account);
    vi.mocked(decryptCredentials).mockReturnValueOnce({
      accessToken: 'decrypted-token',
    } as never);
    mockListTemplates.mockResolvedValueOnce([
      {
        id: 'meta-1',
        name: 'june_offer',
        status: 'APPROVED',
        category: 'MARKETING',
        language: 'en',
        components: [
          { type: 'BODY', text: 'Hi {{1}}, {{2}} this month only.' },
        ],
      },
    ] as never);

    const result = await syncWhatsappTemplates(mockDb as never, {
      organizationId: 'org-1',
      refresh: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(true);
      expect(result.data.templates).toHaveLength(1);
    }
    expect(mockListTemplates).toHaveBeenCalledWith('waba-1');
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'june_offer',
        languageCode: 'en',
        status: 'approved',
        body: 'Hi {{1}}, {{2}} this month only.',
        metaTemplateId: 'meta-1',
      })
    );
  });

  it('returns an actionable reconnect error for an expired Meta token', async () => {
    mockDb.query.whatsappTemplate.findMany.mockResolvedValueOnce([]);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(account);
    vi.mocked(decryptCredentials).mockReturnValueOnce({
      accessToken: 'decrypted-token',
    } as never);
    mockListTemplates.mockRejectedValueOnce(
      new MetaApiError({
        error: {
          code: 190,
          error_subcode: 463,
          message: 'Error validating access token',
        },
      })
    );

    const result = await syncWhatsappTemplates(mockDb as never, {
      organizationId: 'org-1',
      refresh: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('META_AUTH_EXPIRED');
      expect(result.error.message).toContain('reconnect');
    }
  });

  it('returns INTERNAL_ERROR only for an unclassified sync failure', async () => {
    mockDb.query.whatsappTemplate.findMany.mockResolvedValueOnce([]);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(account);
    vi.mocked(decryptCredentials).mockReturnValueOnce({
      accessToken: 'decrypted-token',
    } as never);
    mockListTemplates.mockRejectedValueOnce(new Error('boom'));

    const result = await syncWhatsappTemplates(mockDb as never, {
      organizationId: 'org-1',
      refresh: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
