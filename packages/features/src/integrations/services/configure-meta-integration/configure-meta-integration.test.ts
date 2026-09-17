import { encryptCredentials } from '@borradh-workspace/integrations';
import { mockMetaOAuthService } from '@borradh-workspace/integrations/meta-ads';
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
import { configureMetaIntegration } from './configure-meta-integration.service.js';

const mockSubscribePageToWebhooks = vi.mocked(
  mockMetaOAuthService.subscribePageToWebhooks
);

describe('configureMetaIntegration', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockSubscribePageToWebhooks.mockReset();
    vi.mocked(encryptCredentials).mockReturnValue('encrypted_page_token');
  });

  const validInput = {
    organizationId: 'org-123',
    integrationId: 'meta-456',
    adAccountIds: ['act_123'],
    pageIds: ['page_123'],
    instagramAccountIds: [] as string[],
  };

  const mockExistingIntegration = {
    id: 'meta-456',
    organizationId: 'org-123',
    configurationStatus: 'pending_selection',
    defaultPageId: null,
    availableAdAccounts: [
      {
        id: 'act_123',
        accountId: '123',
        name: 'Test Ad Account',
        accountStatus: 1,
      },
    ],
    availablePages: [
      {
        id: 'page_123',
        name: 'Test Page',
        accessToken: 'page_access_token',
      },
    ],
  };

  it('configures meta integration successfully', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockExistingIntegration
    );
    mockSubscribePageToWebhooks.mockResolvedValueOnce(undefined);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'meta-456',
        organizationId: 'org-123',
        adAccountId: 'act_123',
        configurationStatus: 'configured',
        defaultPageId: null,
      },
    ]);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'page-record-1',
        metaAdsIntegrationId: 'meta-456',
        pageId: 'page_123',
        pageName: 'Test Page',
      },
    ]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'meta-456',
        organizationId: 'org-123',
        defaultPageId: 'page-record-1',
      },
    ]);

    const result = await configureMetaIntegration(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integration).toBeDefined();
      expect(result.data.pages).toBeDefined();
      expect(result.data.pages).toHaveLength(1);
    }
    // Fields are DERIVED from the webhook registry — this call site used to
    // hand-type an 8-field array while two others hand-typed a 4-field one.
    expect(mockSubscribePageToWebhooks).toHaveBeenCalledWith(
      'page_123',
      'page_access_token'
    );
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      configureMetaIntegration(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing integrationId', async () => {
    await expectResult(
      configureMetaIntegration(mockDb as never, {
        ...validInput,
        integrationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty adAccountIds', async () => {
    await expectResult(
      configureMetaIntegration(mockDb as never, {
        ...validInput,
        adAccountIds: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty pageIds', async () => {
    await expectResult(
      configureMetaIntegration(mockDb as never, {
        ...validInput,
        pageIds: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when integration does not exist', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    await expectResult(
      configureMetaIntegration(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns CONFLICT when integration is already configured', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      ...mockExistingIntegration,
      configurationStatus: 'configured',
    });
    await expectResult(
      configureMetaIntegration(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it('returns VALIDATION_ERROR when ad account is not in available list', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      ...mockExistingIntegration,
      availableAdAccounts: [],
    });
    await expectResult(
      configureMetaIntegration(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when ad account is disabled', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      ...mockExistingIntegration,
      availableAdAccounts: [
        {
          id: 'act_123',
          accountId: '123',
          name: 'Disabled',
          accountStatus: 2,
        },
      ],
    });
    await expectResult(
      configureMetaIntegration(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when selected page is not available', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      ...mockExistingIntegration,
      availablePages: [],
    });
    await expectResult(
      configureMetaIntegration(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns EXTERNAL_SERVICE_ERROR when webhook subscription fails', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockExistingIntegration
    );
    mockSubscribePageToWebhooks.mockRejectedValueOnce(
      new Error('webhook subscription failed')
    );
    await expectResult(
      configureMetaIntegration(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('returns INTERNAL_ERROR on unexpected database failure', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockRejectedValueOnce(
      new Error('DB error')
    );
    await expectResult(
      configureMetaIntegration(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
