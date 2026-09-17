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
import { completePractitionerProfileSetup } from './complete-practitioner-profile-setup.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const PRAC_ID = 'prac-1';

const mockPractitioner = {
  id: PRAC_ID,
  organizationId: ORG_ID,
  name: 'Jane Doe',
  email: 'jane@example.com',
  profileSetupCompleted: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('completePractitionerProfileSetup', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  it('completes profile setup successfully', async () => {
    mockDb.returning.mockResolvedValueOnce([mockPractitioner]);

    const result = await completePractitionerProfileSetup(mockDb as never, {
      practitionerId: PRAC_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profileSetupCompleted).toBe(true);
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ profileSetupCompleted: true });
  });

  it('returns NOT_FOUND when practitioner does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      completePractitionerProfileSetup(mockDb as never, {
        practitionerId: 'nonexistent',
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty practitionerId', async () => {
    await expectResult(
      completePractitionerProfileSetup(mockDb as never, {
        practitionerId: '',
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      completePractitionerProfileSetup(mockDb as never, {
        practitionerId: PRAC_ID,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expectResult(
      completePractitionerProfileSetup(mockDb as never, {
        practitionerId: PRAC_ID,
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
