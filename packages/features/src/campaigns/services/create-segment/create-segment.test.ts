import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { createSegment } from './create-segment.service.js';

describe('createSegment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'New leads, last 30 days',
    filterJson: { status: ['new'] },
  };

  it('creates a segment with valid input', async () => {
    const row = {
      id: 'seg_1',
      organizationId: 'org_123',
      name: validInput.name,
      filterJson: validInput.filterJson,
      isDynamic: true,
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    mockDb.returning.mockResolvedValueOnce([row]);

    const result = await createSegment(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe(validInput.name);
      expect(result.data.isDynamic).toBe(true);
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('rejects a blank name with VALIDATION_ERROR', async () => {
    const result = await createSegment(mockDb as never, {
      ...validInput,
      name: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects an unknown filter key (strict schema)', async () => {
    const result = await createSegment(mockDb as never, {
      ...validInput,
      filterJson: { bogusKey: true } as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
