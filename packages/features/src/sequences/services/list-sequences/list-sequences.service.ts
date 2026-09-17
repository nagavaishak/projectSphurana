import { sequence } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListSequencesInput,
  listSequencesSchema,
} from './list-sequences.schema.js';

const listSequencesImpl = async (
  db: DbConnection,
  input: ListSequencesInput
) => {
  const parsed = listSequencesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const conditions: SQL[] = [
    eq(sequence.organizationId, parsed.data.organizationId),
    notDeleted(sequence),
  ];

  if (parsed.data.isActive !== undefined) {
    conditions.push(eq(sequence.isActive, parsed.data.isActive));
  }

  const { limit, offset } = parsed.data;

  const items = await db.query.sequence.findMany({
    where: and(...conditions),
    orderBy: desc(sequence.createdAt),
    limit,
    offset,
  });

  return ok({ items, total: items.length, limit, offset });
};

export const listSequences = (db: DbConnection, input: ListSequencesInput) =>
  trackedResult('sequences.listSequences', () => listSequencesImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });

export type ListSequencesResult = Awaited<ReturnType<typeof listSequences>>;
