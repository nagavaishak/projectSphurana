import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { getCurrentCycle } from './get-current-cycle.service.js';
import {
  type HasPushedTopPickInput,
  hasPushedTopPickSchema,
} from './push-memory.schema.js';

/**
 * Has Claire already pushed the top pick in this conversation for this
 * flow kind (ad vs offer)?
 *
 * Decision #10: push at most once per cycle. A cycle is the lifetime of an
 * active `assistantRecommendation` row tied to (org, conversation, kind).
 * When the row transitions away from `active` (actioned / dismissed /
 * expired), a fresh push is allowed.
 */
const hasPushedTopPickImpl = async (
  db: DbConnection,
  input: HasPushedTopPickInput
): Promise<Result<boolean>> => {
  const parsed = hasPushedTopPickSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const cycle = await getCurrentCycle(db, parsed.data);
  if (!cycle.success) {
    return err(new FeatureError(cycle.error.code, cycle.error.message));
  }
  return ok(cycle.data !== null);
};

export const hasPushedTopPick = (
  db: DbConnection,
  input: HasPushedTopPickInput
) =>
  trackedResult(
    'claire.pushMemory.hasPushedTopPick',
    () => hasPushedTopPickImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        kind: input.kind,
      },
      internalErrorsOnly: true,
    }
  );

export type HasPushedTopPickResult = Awaited<
  ReturnType<typeof hasPushedTopPick>
>;
