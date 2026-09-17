import { isFeatureOn } from '@borradh-workspace/observability';
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
import { deletePractitioner } from './delete-practitioner.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const PRAC_ID = 'prac-1';

describe('deletePractitioner', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureOn).mockResolvedValue(true);
    mockDb._resetMocks();
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  it('soft-deletes practitioner successfully', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: PRAC_ID, isActive: false }]);

    const result = await deletePractitioner(mockDb as never, {
      id: PRAC_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date),
      isActive: false,
    });
  });

  it('returns NOT_FOUND when practitioner does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      deletePractitioner(mockDb as never, {
        id: 'nonexistent',
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty id', async () => {
    await expectResult(
      deletePractitioner(mockDb as never, {
        id: '',
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      deletePractitioner(mockDb as never, {
        id: PRAC_ID,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expectResult(
      deletePractitioner(mockDb as never, {
        id: PRAC_ID,
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
