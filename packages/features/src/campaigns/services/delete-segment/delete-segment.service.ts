import { segment, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import {
  type DeleteSegmentInput,
  deleteSegmentSchema,
} from './delete-segment.schema.js';

const deleteSegmentImpl = async (
  db: DbConnection,
  input: DeleteSegmentInput
) => {
  const parsed = deleteSegmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Soft delete — preserves campaigns that reference this segment.
  const [row] = await db
    .update(segment)
    .set({ deletedAt: new Date() })
    .where(and(eq(segment.id, parsed.data.id), notDeleted(segment)))
    .returning();

  if (!row) {
    return err(
      new FeatureError(
        CampaignErrorCodes.SEGMENT_NOT_FOUND,
        'Segment not found'
      )
    );
  }

  return ok({ success: true, id: row.id });
};

export const deleteSegment = (db: DbConnection, input: DeleteSegmentInput) =>
  trackedResult(
    'campaigns.deleteSegment',
    () => withOrgScope((tx) => deleteSegmentImpl(tx, input), { db }),
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type DeleteSegmentResult = Awaited<ReturnType<typeof deleteSegment>>;
