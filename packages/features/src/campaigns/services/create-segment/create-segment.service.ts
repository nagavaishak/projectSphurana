import { segment, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateSegmentInput,
  createSegmentSchema,
} from './create-segment.schema.js';

const createSegmentImpl = async (
  db: DbConnection,
  input: CreateSegmentInput
) => {
  const parsed = createSegmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const [row] = await db
    .insert(segment)
    .values({
      organizationId: parsed.data.organizationId,
      name: parsed.data.name,
      filterJson: parsed.data.filterJson,
      isDynamic: parsed.data.isDynamic,
      createdById: parsed.data.createdById ?? null,
    })
    .returning();

  return ok(row);
};

export const createSegment = (db: DbConnection, input: CreateSegmentInput) =>
  trackedResult(
    'campaigns.createSegment',
    () => withOrgScope((tx) => createSegmentImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type CreateSegmentResult = Awaited<ReturnType<typeof createSegment>>;
