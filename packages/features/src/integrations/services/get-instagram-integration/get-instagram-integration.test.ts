import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getInstagramIntegration } from './get-instagram-integration.service.js';

describe('getInstagramIntegration', () => {
  const mocks = {
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockLeftJoin: vi.fn(),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
  };

  const mockDb = {
    select: mocks.mockSelect,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ leftJoin: mocks.mockLeftJoin });
    mocks.mockLeftJoin.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ limit: mocks.mockLimit });
  });

  const validInput = { organizationId: 'org_123' };

  it('should return integration when found', async () => {
    const mockIntegration = {
      id: 'ig_123',
      instagramUserId: 'ig_user_1',
      username: 'testbiz',
      name: 'Test Business',
      profilePictureUrl: 'https://example.com/pic.jpg',
      accountType: 'BUSINESS',
      isActive: true,
      tokenStatus: 'valid',
      connectedByName: 'John Doe',
      tokenExpiresAt: new Date(),
      createdAt: new Date(),
    };
    mocks.mockLimit.mockResolvedValueOnce([mockIntegration]);

    const result = await getInstagramIntegration(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integration).toBeTruthy();
      expect(result.data.integration?.username).toBe('testbiz');
    }
  });

  it('should return null integration when not found', async () => {
    mocks.mockLimit.mockResolvedValueOnce([]);

    const result = await getInstagramIntegration(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integration).toBeNull();
    }
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      getInstagramIntegration(mockDb, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mocks.mockLimit.mockRejectedValueOnce(new Error('DB error'));

    await expectResult(
      getInstagramIntegration(mockDb, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
