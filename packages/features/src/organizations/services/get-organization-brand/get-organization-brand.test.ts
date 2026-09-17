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

// No `vi.mock` of `content-styles`: the module is pure data/logic (template
// lookup + colour overrides), so the real implementation is harmless here, and
// under `isolate: false` a file-local bare-factory mock would poison the shared
// module graph for every later test file. The expected colours below are the
// real `clean_minimal` template's defaults.
import { getOrganizationBrand } from './get-organization-brand.service.js';

describe('getOrganizationBrand', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return brand config when organization exists', async () => {
    const mockOrg = {
      id: 'org_123',
      primaryColor: '#FF5733',
      secondaryColor: '#33FF57',
      contentStyleTemplate: 'clean_minimal',
      logo: 'https://example.com/logo.png',
      tagline: 'Best salon in town',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);

    const result = await getOrganizationBrand(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationId).toBe('org_123');
      expect(result.data.primaryColor).toBe('#FF5733');
      expect(result.data.secondaryColor).toBe('#33FF57');
      expect(result.data.contentStyleTemplate).toBe('clean_minimal');
      expect(result.data.logoUrl).toBe('https://example.com/logo.png');
      expect(result.data.tagline).toBe('Best salon in town');
    }
  });

  it('should use default colors when not set', async () => {
    const mockOrg = {
      id: 'org_123',
      primaryColor: null,
      secondaryColor: null,
      contentStyleTemplate: 'clean_minimal',
      logo: null,
      tagline: null,
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);

    const result = await getOrganizationBrand(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryColor).toBe('#1e293b'); // clean_minimal default
      expect(result.data.secondaryColor).toBe('#64748b'); // clean_minimal default
    }
  });

  it('should use default template when not set', async () => {
    const mockOrg = {
      id: 'org_123',
      primaryColor: null,
      secondaryColor: null,
      contentStyleTemplate: null,
      logo: null,
      tagline: null,
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);

    const result = await getOrganizationBrand(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentStyleTemplate).toBe('clean_minimal');
    }
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getOrganizationBrand(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Organization not found');
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      getOrganizationBrand(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = { organizationId: '' };

    await expectResult(
      getOrganizationBrand(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organization.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      getOrganizationBrand(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
