import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as getMetaIntegrationModule from '../get-meta-integration/get-meta-integration.service.js';
import { listMetaLeadForms } from './list-meta-lead-forms.service.js';

const mocks = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
}));

const mockDecryptCredentials = vi.mocked(decryptCredentials);
const mockListLeadGenForms = vi.mocked(mockMetaAdsService.listLeadGenForms);

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` a hoisted
// bare-factory mock of an internal module leaks onto the shared worker graph
// (deleting every export it omits) and silently misses when an earlier file
// already imported the real module (get-meta-integration.test.ts does). The
// service imports through the `../get-meta-integration/index.js` barrel, whose
// live getters cannot be redefined, so we spy the SOURCE module it forwards to.
let mockGetMetaIntegration: MockInstance;

describe('listMetaLeadForms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMetaIntegration = vi.spyOn(
      getMetaIntegrationModule,
      'getMetaIntegration'
    );
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ limit: mocks.mockLimit });
  });

  afterEach(() => {
    mockGetMetaIntegration.mockRestore();
  });

  const mockDb = { select: mocks.mockSelect } as never;

  const validInput = { organizationId: 'org_123' };

  it('should list lead forms successfully', async () => {
    mockGetMetaIntegration.mockResolvedValueOnce({
      success: true,
      data: {
        adAccountId: 'act_123',
        defaultPage: { pageId: 'page_123' },
      },
    });
    mocks.mockLimit.mockResolvedValueOnce([
      { encryptedCredentials: 'encrypted_data' },
    ]);
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });
    mockListLeadGenForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Test Form' },
    ]);

    const result = await listMetaLeadForms(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forms).toHaveLength(1);
      expect(result.data.forms[0].name).toBe('Test Form');
    }
  });

  it('should return NOT_FOUND when integration not found', async () => {
    mockGetMetaIntegration.mockResolvedValueOnce({
      success: true,
      data: null,
    });

    await expectResult(listMetaLeadForms(mockDb, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it('should return VALIDATION_ERROR when no default page', async () => {
    mockGetMetaIntegration.mockResolvedValueOnce({
      success: true,
      data: {
        adAccountId: 'act_123',
        defaultPage: null,
      },
    });
    mocks.mockLimit.mockResolvedValueOnce([
      { encryptedCredentials: 'encrypted_data' },
    ]);
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });

    await expectResult(listMetaLeadForms(mockDb, validInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      listMetaLeadForms(mockDb, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR when Meta API fails', async () => {
    mockGetMetaIntegration.mockResolvedValueOnce({
      success: true,
      data: {
        adAccountId: 'act_123',
        defaultPage: { pageId: 'page_123' },
      },
    });
    mocks.mockLimit.mockResolvedValueOnce([
      { encryptedCredentials: 'encrypted_data' },
    ]);
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });
    mockListLeadGenForms.mockRejectedValueOnce(new Error('Meta API error'));

    await expectResult(listMetaLeadForms(mockDb, validInput)).toFailWithCode(
      ErrorCodes.INTERNAL_ERROR
    );
  });
});
