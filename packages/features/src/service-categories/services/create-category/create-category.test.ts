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
import { createCategory } from './create-category.service.js';

describe('createCategory', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('creates a category with valid input', async () => {
    mockDb.query.organizationServiceCategory.findFirst.mockResolvedValueOnce(
      null
    );
    mockDb.returning.mockResolvedValueOnce([
      { id: 'cat_123', name: 'Hair Services', organizationId: 'org_123' },
    ]);

    const result = await createCategory(mockDb as never, {
      organizationId: 'org_123',
      name: 'Hair Services',
    });

    expect(result.success).toBe(true);
  });

  it('returns ALREADY_EXISTS for duplicate name', async () => {
    mockDb.query.organizationServiceCategory.findFirst.mockResolvedValueOnce({
      id: 'cat_existing',
    });

    await expectResult(
      createCategory(mockDb as never, {
        organizationId: 'org_123',
        name: 'Hair Services',
      })
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns VALIDATION_ERROR for missing name', async () => {
    await expectResult(
      createCategory(
        mockDb as never,
        {
          organizationId: 'org_123',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
