import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { updateWhatsappTemplateStatus } from './update-whatsapp-template-status.service.js';

describe('updateWhatsappTemplateStatus', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    mockDb._resetMocks();
  });

  it('returns VALIDATION_ERROR when wabaId is missing', async () => {
    const result = await updateWhatsappTemplateStatus(mockDb as never, {
      wabaId: '',
      event: 'APPROVED',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('is a no-op for an unrecognised Meta event (never touches the db)', async () => {
    const result = await updateWhatsappTemplateStatus(mockDb as never, {
      wabaId: 'waba-1',
      metaTemplateId: 'meta-1',
      event: 'CATEGORY_UPDATE',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(0);
      expect(result.data.status).toBeNull();
    }
    expect(mockDb.query.whatsappAccount.findFirst).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('is a no-op when the WABA is not linked to any org', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await updateWhatsappTemplateStatus(mockDb as never, {
      wabaId: 'waba-unknown',
      metaTemplateId: 'meta-1',
      event: 'APPROVED',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.updated).toBe(0);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('approves the cached template matched by metaTemplateId', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      organizationId: 'org-1',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'tpl-1' }]);

    const result = await updateWhatsappTemplateStatus(mockDb as never, {
      wabaId: 'waba-1',
      metaTemplateId: 'meta-1',
      name: 'june_offer',
      languageCode: 'en',
      event: 'APPROVED',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(1);
      expect(result.data.status).toBe('approved');
    }
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' })
    );
  });

  it('falls back to name+language when no row matches the metaTemplateId', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      organizationId: 'org-1',
    });
    // First update (by metaTemplateId) matches nothing; second (by name+lang) hits.
    mockDb.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'tpl-1' }]);

    const result = await updateWhatsappTemplateStatus(mockDb as never, {
      wabaId: 'waba-1',
      metaTemplateId: 'meta-1',
      name: 'june_offer',
      languageCode: 'en',
      event: 'REJECTED',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(1);
      expect(result.data.status).toBe('rejected');
    }
    // The fallback backfills the metaTemplateId alongside the status.
    expect(mockDb.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'rejected', metaTemplateId: 'meta-1' })
    );
  });
});
