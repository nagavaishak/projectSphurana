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
import { listPractitioners } from './list-practitioners.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';

const mockPractitioners = [
  {
    id: 'prac-1',
    organizationId: ORG_ID,
    name: 'Jane Doe',
    email: 'jane@example.com',
    isActive: true,
    locations: [],
    services: [],
  },
  {
    id: 'prac-2',
    organizationId: ORG_ID,
    name: 'John Smith',
    email: 'john@example.com',
    isActive: true,
    locations: [],
    services: [],
  },
];

describe('listPractitioners', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns list of practitioners', async () => {
    mockDb.query.practitioner.findMany.mockResolvedValueOnce(mockPractitioners);

    const result = await listPractitioners(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].name).toBe('Jane Doe');
    }
  });

  it('returns empty list when none exist', async () => {
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([]);

    const result = await listPractitioners(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
    }
  });

  it('uses default limit and offset', async () => {
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([]);

    const result = await listPractitioners(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      listPractitioners(mockDb as never, {
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
