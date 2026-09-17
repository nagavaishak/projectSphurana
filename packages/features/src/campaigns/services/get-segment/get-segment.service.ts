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
  type GetSegmentInput,
  getSegmentSchema,
} from './get-segment.schema.js';

const getSegmentImpl = async (db: DbConnection, input: GetSegmentInput) => {
  const parsed = getSegmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const row = await db.query.segment.findFirst({
    // Explicit org scoping (defence-in-depth alongside RLS): without it a
    // caller could read another org's segment by id when RLS is off.
    where: and(
      eq(segment.id, parsed.data.id),
      eq(segment.organizationId, parsed.data.organizationId),
      notDeleted(segment)
    ),
  });

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

export const getSegment = (db: DbConnection, input: GetSegmentInput) =>
  trackedResult(
    'campaigns.getSegment',
    () => withOrgScope((tx) => getSegmentImpl(tx, input), { db }),
    { properties: { id: input.id }, internalErrorsOnly: true }
  );

export type GetSegmentResult = Awaited<ReturnType<typeof getSegment>>;
