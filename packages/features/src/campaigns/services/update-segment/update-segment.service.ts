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
  type UpdateSegmentInput,
  updateSegmentSchema,
} from './update-segment.schema.js';

const updateSegmentImpl = async (
  db: DbConnection,
  input: UpdateSegmentInput
) => {
  const parsed = updateSegmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, name, filterJson, isDynamic } = parsed.data;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (filterJson !== undefined) updates.filterJson = filterJson;
  if (isDynamic !== undefined) updates.isDynamic = isDynamic;

  // Nothing to change → return the current row (avoids an empty SET).
  if (Object.keys(updates).length === 0) {
    const existing = await db.query.segment.findFirst({
      where: and(
        eq(segment.id, id),
        eq(segment.organizationId, organizationId),
        notDeleted(segment)
      ),
    });
    if (!existing) {
      return err(
        new FeatureError(
          CampaignErrorCodes.SEGMENT_NOT_FOUND,
          'Segment not found'
        )
      );
    }
    return ok(existing);
  }

  const [row] = await db
    .update(segment)
    .set(updates)
    .where(
      and(
        eq(segment.id, id),
        eq(segment.organizationId, organizationId),
        notDeleted(segment)
      )
    )
    .returning();

  if (!row) {
    return err(
      new FeatureError(
        CampaignErrorCodes.SEGMENT_NOT_FOUND,
        'Segment not found'
      )
    );
  }

  return ok(row);
};

export const updateSegment = (db: DbConnection, input: UpdateSegmentInput) =>
  trackedResult(
    'campaigns.updateSegment',
    () => withOrgScope((tx) => updateSegmentImpl(tx, input), { db }),
    { properties: { id: input.id, organizationId: input.organizationId } }
  );

export type UpdateSegmentResult = Awaited<ReturnType<typeof updateSegment>>;
