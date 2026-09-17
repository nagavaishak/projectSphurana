import { drizzleUniqueViolation } from '@borradh-workspace/database';
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
import { updateIntakeForm } from './update-intake-form.service.js';

describe('updateIntakeForm', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-1',
    id: 'form-1',
    name: 'Renamed form',
  };

  it('updates a form', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'form-1', ...validInput }]);

    await expectResult(
      updateIntakeForm(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.name).toBe('Renamed form');
    });
  });

  it('returns VALIDATION_ERROR when there is nothing to update', async () => {
    await expectResult(
      updateIntakeForm(mockDb as never, {
        organizationId: 'org-1',
        id: 'form-1',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when no row matches', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateIntakeForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns ALREADY_EXISTS when the name collides with another form', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('uq_form_org_kind_name')
    );

    await expectResult(
      updateIntakeForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on an unrelated db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateIntakeForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
