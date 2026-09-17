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
import { reorderResources } from './reorder-resources.service.js';

describe('reorderResources', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_1',
    items: [
      { id: 'res_1', sortOrder: 1 },
      { id: 'res_2', sortOrder: 0 },
    ],
  };

  it('writes the whole order in one transaction', async () => {
    mockDb.query.resource.findMany.mockResolvedValueOnce([
      { id: 'res_1' },
      { id: 'res_2' },
    ]);

    await expectResult(
      reorderResources(mockDb as never, validInput)
    ).toSucceedWith();

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 1 })
    );
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 0 })
    );
  });

  it('returns VALIDATION_ERROR when an id belongs to another org', async () => {
    mockDb.query.resource.findMany.mockResolvedValueOnce([{ id: 'res_1' }]);

    await expectResult(
      reorderResources(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when the same resource appears twice', async () => {
    await expectResult(
      reorderResources(mockDb as never, {
        organizationId: 'org_1',
        items: [
          { id: 'res_1', sortOrder: 0 },
          { id: 'res_1', sortOrder: 1 },
        ],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.resource.findMany).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an empty batch', async () => {
    await expectResult(
      reorderResources(mockDb as never, { organizationId: 'org_1', items: [] })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for a negative sortOrder', async () => {
    await expectResult(
      reorderResources(mockDb as never, {
        organizationId: 'org_1',
        items: [{ id: 'res_1', sortOrder: -1 }],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when organizationId is missing', async () => {
    await expectResult(
      reorderResources(
        mockDb as never,
        {
          items: [{ id: 'res_1', sortOrder: 0 }],
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.resource.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      reorderResources(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
