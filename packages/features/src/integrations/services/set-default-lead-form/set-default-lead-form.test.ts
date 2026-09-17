import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { setDefaultLeadForm } from './set-default-lead-form.service.js';

describe('setDefaultLeadForm', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
    leadFormId: 'form-456',
    leadFormName: 'Contact Form',
  };

  it('sets default lead form successfully', async () => {
    // Service calls db.query.metaAdsIntegration.findFirst to check integration exists
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'meta-789',
      organizationId: 'org-123',
    });

    // No pageId in input, so service calls db.query.metaAdsPage.findFirst to get default page
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-record-1',
      pageId: 'page-123',
    });

    // Service calls db.update(metaAdsPage).set(...).where(...)
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await setDefaultLeadForm(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.leadFormId).toBe('form-456');
      expect(result.data.leadFormName).toBe('Contact Form');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('sets default lead form with specific pageId', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'meta-789',
      organizationId: 'org-123',
    });

    // pageId provided in input, so service does NOT call db.query.metaAdsPage.findFirst
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await setDefaultLeadForm(mockDb as never, {
      organizationId: 'org-123',
      leadFormId: 'form-456',
      leadFormName: 'Contact Form',
      pageId: 'page-record-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadFormId).toBe('form-456');
    }
  });

  it('sets default lead form without name', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'meta-789',
      organizationId: 'org-123',
    });

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-record-1',
      pageId: 'page-123',
    });

    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await setDefaultLeadForm(mockDb as never, {
      organizationId: 'org-123',
      leadFormId: 'form-456',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.leadFormName).toBeNull();
  });

  it('returns NOT_FOUND when integration does not exist', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await setDefaultLeadForm(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no pages exist and no pageId provided', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'meta-789',
      organizationId: 'org-123',
    });

    // No pages found
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);

    const result = await setDefaultLeadForm(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await setDefaultLeadForm(mockDb as never, {
      organizationId: '',
      leadFormId: 'form-456',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing leadFormId', async () => {
    const result = await setDefaultLeadForm(mockDb as never, {
      organizationId: 'org-123',
      leadFormId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'meta-789',
      organizationId: 'org-123',
    });

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-record-1',
      pageId: 'page-123',
    });

    // db.update().set().where() throws
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('DB error'));

    const result = await setDefaultLeadForm(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
