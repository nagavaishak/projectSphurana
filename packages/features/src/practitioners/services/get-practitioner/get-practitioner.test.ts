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
import { getPractitioner } from './get-practitioner.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';

const mockPractitioner = {
  id: 'prac-1',
  organizationId: ORG_ID,
  name: 'Jane Doe',
  email: 'jane@example.com',
  isActive: true,
  locations: [],
  services: [],
  calendarAccount: null,
};

describe('getPractitioner', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns practitioner when found', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(mockPractitioner);

    const result = await getPractitioner(mockDb as never, {
      id: 'prac-1',
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('prac-1');
      expect(result.data.name).toBe('Jane Doe');
    }
  });

  it('returns NOT_FOUND when practitioner does not exist', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getPractitioner(mockDb as never, {
        id: 'nonexistent',
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty id', async () => {
    await expectResult(
      getPractitioner(mockDb as never, {
        id: '',
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      getPractitioner(mockDb as never, {
        id: 'prac-1',
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
