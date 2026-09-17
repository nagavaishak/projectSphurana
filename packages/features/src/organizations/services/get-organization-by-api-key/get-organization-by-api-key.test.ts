import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getOrganizationByApiKey } from './get-organization-by-api-key.service.js';

describe('getOrganizationByApiKey', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    apiKey: 'sk_live_abc123xyz',
  };

  it('should return organization when API key is valid', async () => {
    const mockOrg = {
      id: 'org_123',
      name: 'My Organization',
      slug: 'my-org',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);

    const result = await getOrganizationByApiKey(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('org_123');
      expect(result.data.name).toBe('My Organization');
      expect(result.data.slug).toBe('my-org');
    }
  });

  it('should return UNAUTHORIZED when API key is invalid', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getOrganizationByApiKey(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(error.message).toBe('Invalid API key');
    });
  });

  it('should return VALIDATION_ERROR for missing apiKey', async () => {
    const invalidInput = {};

    await expectResult(
      getOrganizationByApiKey(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty apiKey', async () => {
    const invalidInput = { apiKey: '' };

    await expectResult(
      getOrganizationByApiKey(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organization.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(
      getOrganizationByApiKey(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
