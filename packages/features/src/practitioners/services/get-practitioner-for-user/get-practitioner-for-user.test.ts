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
import { getPractitionerForUser } from './get-practitioner-for-user.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = 'user-1';

const mockPractitioner = {
  id: 'prac-1',
  organizationId: ORG_ID,
  userId: USER_ID,
  name: 'Jane Doe',
  email: 'jane@example.com',
  isActive: true,
  services: [],
  calendarAccount: null,
};

describe('getPractitionerForUser', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns practitioner linked to user', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(mockPractitioner);

    const result = await getPractitionerForUser(mockDb as never, {
      userId: USER_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe(USER_ID);
    }
  });

  it('returns NOT_FOUND when no practitioner linked to user', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getPractitionerForUser(mockDb as never, {
        userId: USER_ID,
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty userId', async () => {
    await expectResult(
      getPractitionerForUser(mockDb as never, {
        userId: '',
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      getPractitionerForUser(mockDb as never, {
        userId: USER_ID,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
