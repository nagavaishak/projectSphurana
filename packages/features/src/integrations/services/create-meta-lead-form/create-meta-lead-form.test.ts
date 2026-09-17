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
import * as setDefaultLeadFormModule from '../set-default-lead-form/set-default-lead-form.service.js';
import { createMetaLeadForm } from './create-meta-lead-form.service.js';

const mocks = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
}));

const mockDecryptCredentials = vi.mocked(decryptCredentials);
const mockCreateLeadGenForm = vi.mocked(mockMetaAdsService.createLeadGenForm);

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` a hoisted
// bare-factory mock of an internal module leaks onto the shared worker graph
// (deleting every export it omits) and silently misses when an earlier file
// already imported the real module (both siblings have their own test file).
// The service imports through the `index.js` barrels, whose live getters cannot
// be redefined, so we spy the SOURCE modules those barrels forward to.
let mockGetMetaIntegration: MockInstance;
let mockSetDefaultLeadForm: MockInstance;

describe('createMetaLeadForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMetaIntegration = vi.spyOn(
      getMetaIntegrationModule,
      'getMetaIntegration'
    );
    mockSetDefaultLeadForm = vi.spyOn(
      setDefaultLeadFormModule,
      'setDefaultLeadForm'
    );
    // Reset select chain
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ limit: mocks.mockLimit });
  });

  afterEach(() => {
    mockGetMetaIntegration.mockRestore();
    mockSetDefaultLeadForm.mockRestore();
  });

  const mockDb = {
    select: mocks.mockSelect,
  } as never;

  const validInput = {
    organizationId: 'org_123',
    name: 'Test Lead Form',
    questions: [{ type: 'FULL_NAME' }],
    privacyPolicyUrl: 'https://example.com/privacy',
  };

  it('should create a lead form successfully', async () => {
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
    mockCreateLeadGenForm.mockResolvedValueOnce('form_456');
    mockSetDefaultLeadForm.mockResolvedValueOnce({ success: true });

    const result = await createMetaLeadForm(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formId).toBe('form_456');
      expect(result.data.name).toBe('Test Lead Form');
    }
  });

  it('should return error when integration not found', async () => {
    mockGetMetaIntegration.mockResolvedValueOnce({
      success: true,
      data: null,
    });

    await expectResult(createMetaLeadForm(mockDb, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it('should return error when getMetaIntegration fails', async () => {
    mockGetMetaIntegration.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'Failed' },
    });

    await expectResult(createMetaLeadForm(mockDb, validInput)).toFailWithCode(
      ErrorCodes.INTERNAL_ERROR
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

    await expectResult(createMetaLeadForm(mockDb, validInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should return VALIDATION_ERROR when no ad account', async () => {
    mockGetMetaIntegration.mockResolvedValueOnce({
      success: true,
      data: {
        adAccountId: null,
        defaultPage: { pageId: 'page_123' },
      },
    });
    mocks.mockLimit.mockResolvedValueOnce([
      { encryptedCredentials: 'encrypted_data' },
    ]);
    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });

    await expectResult(createMetaLeadForm(mockDb, validInput)).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });

  it('should return VALIDATION_ERROR for missing name', async () => {
    await expectResult(
      createMetaLeadForm(mockDb, { ...validInput, name: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid privacyPolicyUrl', async () => {
    await expectResult(
      createMetaLeadForm(mockDb, {
        ...validInput,
        privacyPolicyUrl: 'not-a-url',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR when credentials not found', async () => {
    mockGetMetaIntegration.mockResolvedValueOnce({
      success: true,
      data: {
        adAccountId: 'act_123',
        defaultPage: { pageId: 'page_123' },
      },
    });
    mocks.mockLimit.mockResolvedValueOnce([{ encryptedCredentials: null }]);

    await expectResult(createMetaLeadForm(mockDb, validInput)).toFailWithCode(
      ErrorCodes.INTERNAL_ERROR
    );
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
    mockCreateLeadGenForm.mockRejectedValueOnce(new Error('Meta API error'));

    await expectResult(createMetaLeadForm(mockDb, validInput)).toFailWithCode(
      ErrorCodes.INTERNAL_ERROR
    );
  });
});
