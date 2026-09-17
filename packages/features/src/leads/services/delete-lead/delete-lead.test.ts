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
import { deleteLead } from './delete-lead.service.js';

describe('deleteLead', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureOn).mockResolvedValue(true);
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'lead_123',
    organizationId: 'org_123',
  };

  const existingLead = {
    id: 'lead_123',
    organizationId: 'org_123',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    status: 'new',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should delete lead when it exists', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);

    const result = await deleteLead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(validInput.id);
    }

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date),
    });
  });

  it('should return NOT_FOUND when lead does not exist', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    await expectResult(deleteLead(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain(validInput.id);
      }
    );

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      deleteLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'lead_123',
    };

    await expectResult(
      deleteLead(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(
      deleteLead(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      id: 'lead_123',
      organizationId: '',
    };

    await expectResult(
      deleteLead(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(existingLead);
    mockDb.update.mockImplementationOnce(() => {
      throw new Error('Database connection failed');
    });

    await expect(deleteLead(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });

  /**
   * The HARD-delete path — reached only when `killswitch-soft-deletes` is off.
   * Every test above pins the flag ON, so none of them reach this branch, and
   * it is the branch where erasing the person used to erase the clinical
   * record proving they consented to a treatment they already received.
   */
  describe('hard delete (soft-deletes killswitch off)', () => {
    beforeEach(() => {
      vi.mocked(isFeatureOn).mockResolvedValue(false);
    });

    it('purges pending consent forms and deletes the lead', async () => {
      mockDb.where.mockResolvedValueOnce(undefined as never); // the DELETE
      mockDb.where.mockResolvedValueOnce([] as never); // no signed forms

      const result = await deleteLead(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('refuses with CONFLICT when a SIGNED consent form is attached', async () => {
      mockDb.where.mockResolvedValueOnce(undefined as never); // the DELETE
      mockDb.where.mockResolvedValueOnce([{ id: 'sub_1' }] as never); // signed

      await expectResult(deleteLead(mockDb as never, validInput)).toFailWith(
        (error) => {
          expect(error.code).toBe(ErrorCodes.CONFLICT);
          expect(error.message).toMatch(/signed consent/i);
        }
      );

      // Only the pending purge ran — the lead row itself must survive.
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
    });
  });
});
