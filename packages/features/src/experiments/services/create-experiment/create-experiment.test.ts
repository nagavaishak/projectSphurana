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
import { createExperiment } from './create-experiment.service.js';

describe('createExperiment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    key: 'onboarding-cta-copy',
    name: 'Onboarding CTA copy',
    variants: {
      control: { label: 'Control', weight: 50 },
      treatment: { label: 'Treatment', weight: 50 },
    },
  };

  it('creates an experiment', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'exp_1', ...validInput, status: 'active' },
    ]);

    await expectResult(
      createExperiment(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.key).toBe('onboarding-cta-copy');
    });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when variant weights do not sum to 100', async () => {
    await expectResult(
      createExperiment(mockDb as never, {
        ...validInput,
        variants: {
          control: { label: 'Control', weight: 40 },
          treatment: { label: 'Treatment', weight: 40 },
        },
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns ALREADY_EXISTS when the key collides with an existing experiment', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('experiment_key_unique')
    );

    await expectResult(
      createExperiment(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on an unrelated db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createExperiment(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
