import { experiment, isUniqueViolation } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { Experiment } from '../../models/index.js';
import {
  type CreateExperimentInput,
  createExperimentSchema,
} from './create-experiment.schema.js';

const createExperimentImpl = async (
  db: DbConnection,
  input: CreateExperimentInput
): Promise<Result<Experiment>> => {
  const parsed = createExperimentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [result] = await db
      .insert(experiment)
      .values(parsed.data)
      .returning();

    return ok(result);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'experiment_key_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Experiment with key "${parsed.data.key}" already exists`
        )
      );
    }

    logError('experiments.createExperiment', error, {
      feature: 'experiments',
      extra: { key: parsed.data.key },
    });

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create experiment')
    );
  }
};

export const createExperiment = (
  db: DbConnection,
  input: CreateExperimentInput
) =>
  trackedResult(
    'experiments.createExperiment',
    () => createExperimentImpl(db, input),
    { properties: { key: input.key } }
  );

export type CreateExperimentResult = Awaited<
  ReturnType<typeof createExperiment>
>;
