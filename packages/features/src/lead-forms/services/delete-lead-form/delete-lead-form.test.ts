import {
  decryptCredentials,
  mockMetaAdsService,
} from '@borradh-workspace/integrations';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import { deleteLeadForm } from './delete-lead-form.service.js';

const archiveLeadGenForm = vi.mocked(mockMetaAdsService.archiveLeadGenForm);

const mockDb = createMockDatabase();

const existingForm = {
  id: 'form-1',
  organizationId: 'org-1',
  name: 'Contact Form',
  status: 'synced',
  metaFormId: null as string | null,
};

describe('deleteLeadForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    archiveLeadGenForm.mockResolvedValue(undefined);
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'mock-token',
    });
  });

  it('should archive lead form successfully', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(existingForm);
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingForm, status: 'archived' },
    ]);

    const result = await deleteLeadForm(mockDb as never, { id: 'form-1' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
  });

  it('should return NOT_FOUND when form does not exist', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteLeadForm(mockDb as never, { id: 'nonexistent' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    await expectResult(
      deleteLeadForm(mockDb as never, { id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.leadForm.findFirst).not.toHaveBeenCalled();
  });

  it('should archive instead of delete when used by ads', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(existingForm);
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({ id: 'ad-1' });
    mockDb.returning.mockResolvedValueOnce([
      { ...existingForm, status: 'archived' },
    ]);

    const result = await deleteLeadForm(mockDb as never, { id: 'form-1' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
  });

  it('should attempt Meta archival when form has metaFormId', async () => {
    const formWithMeta = { ...existingForm, metaFormId: 'meta-123' };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(formWithMeta);
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      isActive: true,
      adAccountId: 'act_123',
      defaultPageId: 'page-1',
      encryptedCredentials: 'encrypted',
    });
    mockDb.returning.mockResolvedValueOnce([
      { ...formWithMeta, status: 'archived' },
    ]);

    const result = await deleteLeadForm(mockDb as never, { id: 'form-1' });

    expect(result.success).toBe(true);
  });

  it('should succeed even when Meta archival fails', async () => {
    const formWithMeta = { ...existingForm, metaFormId: 'meta-123' };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(formWithMeta);
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([
      { ...formWithMeta, status: 'archived' },
    ]);

    const result = await deleteLeadForm(mockDb as never, { id: 'form-1' });

    expect(result.success).toBe(true);
  });
});
