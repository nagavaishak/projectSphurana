import { isFeatureOn } from '@borradh-workspace/observability';
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
import { deleteOffer } from './delete-offer.service.js';

describe('deleteOffer', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureOn).mockResolvedValue(true);
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'offer-1',
    organizationId: 'org-1',
  };

  const existingOffer = {
    id: 'offer-1',
    organizationId: 'org-1',
    name: 'Summer Sale',
  };

  it('deletes offer when found', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce(existingOffer);

    const result = await deleteOffer(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ success: true });
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date),
    });
  });

  it('returns NOT_FOUND when offer does not exist', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce(null);

    await expectResult(deleteOffer(mockDb as never, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      deleteOffer(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      deleteOffer(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
