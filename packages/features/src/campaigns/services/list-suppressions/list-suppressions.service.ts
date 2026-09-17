import { suppression, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListSuppressionsInput,
  listSuppressionsSchema,
} from './list-suppressions.schema.js';

const listSuppressionsImpl = async (
  db: DbConnection,
  input: ListSuppressionsInput
) => {
  const parsed = listSuppressionsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, channel, limit, offset } = parsed.data;

  const conditions: SQL[] = [eq(suppression.organizationId, organizationId)];
  if (channel) conditions.push(eq(suppression.channel, channel));

  const items = await db.query.suppression.findMany({
    where: and(...conditions),
    orderBy: desc(suppression.createdAt),
    limit,
    offset,
  });

  return ok({ items, total: items.length, limit, offset });
};

export const listSuppressions = (
  db: DbConnection,
  input: ListSuppressionsInput
) =>
  trackedResult(
    'campaigns.listSuppressions',
    () => withOrgScope((tx) => listSuppressionsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListSuppressionsResult = Awaited<
  ReturnType<typeof listSuppressions>
>;
