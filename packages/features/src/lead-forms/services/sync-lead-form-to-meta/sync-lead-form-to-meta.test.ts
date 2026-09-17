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

import { syncLeadFormToMeta } from './sync-lead-form-to-meta.service.js';

const mocks = {
  createLeadGenForm: vi.mocked(mockMetaAdsService.createLeadGenForm),
};

const mockDb = createMockDatabase();

const mockForm = {
  id: 'form-1',
  organizationId: 'org-1',
  name: 'Contact Form',
  questions: [{ type: 'EMAIL', label: 'Email' }],
  privacyPolicyUrl: 'https://example.com/privacy',
  privacyPolicyLinkText: null,
  thankYouTitle: null,
  thankYouBody: null,
  thankYouButtonText: null,
  thankYouButtonUrl: null,
  metaPageId: 'page-1',
  status: 'draft',
};

const mockIntegration = {
  organizationId: 'org-1',
  isActive: true,
  adAccountId: 'act_123',
  defaultPageId: 'page-1',
  encryptedCredentials: 'encrypted',
};

const mockPage = {
  id: 'page-1',
  pageId: 'fb-page-123',
  pageAccessToken: 'page-token',
};

describe('syncLeadFormToMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'mock-token',
    });
  });

  it('should sync form to Meta successfully', async () => {
    const syncedForm = { ...mockForm, metaFormId: 'meta-1', status: 'synced' };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(mockForm);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mocks.createLeadGenForm.mockResolvedValueOnce('meta-1');
    mockDb.returning.mockResolvedValueOnce([syncedForm]);

    const result = await syncLeadFormToMeta(mockDb as never, {
      leadFormId: 'form-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaFormId).toBe('meta-1');
      expect(result.data.status).toBe('synced');
    }
  });

  it('should return VALIDATION_ERROR for empty leadFormId', async () => {
    await expectResult(
      syncLeadFormToMeta(mockDb as never, { leadFormId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return NOT_FOUND when form does not exist', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      syncLeadFormToMeta(mockDb as never, { leadFormId: 'nonexistent' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return NOT_FOUND when no active Meta integration', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(mockForm);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      syncLeadFormToMeta(mockDb as never, { leadFormId: 'form-1' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR when no page ID available', async () => {
    const formNoPage = { ...mockForm, metaPageId: null };
    const integrationNoPage = { ...mockIntegration, defaultPageId: null };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(formNoPage);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      integrationNoPage
    );

    await expectResult(
      syncLeadFormToMeta(mockDb as never, { leadFormId: 'form-1' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return NOT_FOUND when page has no access token', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(mockForm);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      ...mockPage,
      pageAccessToken: null,
    });

    await expectResult(
      syncLeadFormToMeta(mockDb as never, { leadFormId: 'form-1' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR when no ad account configured', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(mockForm);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      ...mockIntegration,
      adAccountId: null,
    });
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);

    await expectResult(
      syncLeadFormToMeta(mockDb as never, { leadFormId: 'form-1' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('scopes the form lookup by organizationId when supplied', async () => {
    const syncedForm = { ...mockForm, metaFormId: 'meta-1', status: 'synced' };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(mockForm);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mocks.createLeadGenForm.mockResolvedValueOnce('meta-1');
    mockDb.returning.mockResolvedValueOnce([syncedForm]);

    const result = await syncLeadFormToMeta(mockDb as never, {
      leadFormId: 'form-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    // Two conditions (id + organizationId) rather than the id alone.
    expect(mockDb.query.leadForm.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns NOT_FOUND for a form outside the requesting organization', async () => {
    // The org-scoped WHERE matches nothing — indistinguishable from missing.
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      syncLeadFormToMeta(mockDb as never, {
        leadFormId: 'form-1',
        organizationId: 'other-org',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    // Nothing was synced or written for it.
    expect(mocks.createLeadGenForm).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR when Meta API call fails', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(mockForm);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mocks.createLeadGenForm.mockRejectedValueOnce(new Error('Meta API error'));

    await expectResult(
      syncLeadFormToMeta(mockDb as never, { leadFormId: 'form-1' })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
