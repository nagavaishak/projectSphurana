import { segment, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, count, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListSegmentsInput,
  listSegmentsSchema,
} from './list-segments.schema.js';

const listSegmentsImpl = async (db: DbConnection, input: ListSegmentsInput) => {
  const parsed = listSegmentsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, limit, offset } = parsed.data;

  const items = await db.query.segment.findMany({
    where: and(eq(segment.organizationId, organizationId), notDeleted(segment)),
    orderBy: desc(segment.createdAt),
    limit,
    offset,
  });

  // `total` used to be `items.length` — the PAGE size under a field named
  // total, so it could never exceed `limit`. Count over the SAME predicate.
  const [totalRow] = await db
    .select({ value: count() })
    .from(segment)
    .where(
      and(eq(segment.organizationId, organizationId), notDeleted(segment))
    );

  return ok({ items, total: totalRow?.value ?? 0, limit, offset });
};

export const listSegments = (db: DbConnection, input: ListSegmentsInput) =>
  trackedResult(
    'campaigns.listSegments',
    () => withOrgScope((tx) => listSegmentsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListSegmentsResult = Awaited<ReturnType<typeof listSegments>>;
