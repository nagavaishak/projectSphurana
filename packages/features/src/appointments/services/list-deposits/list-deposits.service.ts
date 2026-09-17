import {
  type AppointmentDeposit,
  appointmentDeposit,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, count, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListDepositsInput,
  listDepositsSchema,
} from './list-deposits.schema.js';

export interface ListDepositsResult {
  items: AppointmentDeposit[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * List deposits with filters
 */
const listDepositsImpl = async (
  db: DbConnection,
  input: ListDepositsInput
): Promise<Result<ListDepositsResult>> => {
  const parsed = listDepositsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, appointmentId, status, limit, offset } = parsed.data;

  // Build where conditions
  const conditions: SQL[] = [
    eq(appointmentDeposit.organizationId, organizationId),
  ];

  if (appointmentId) {
    conditions.push(eq(appointmentDeposit.appointmentId, appointmentId));
  }

  if (status) {
    conditions.push(eq(appointmentDeposit.status, status));
  }

  const whereClause = and(...conditions);

  // Get items
  const items = await db.query.appointmentDeposit.findMany({
    where: whereClause,
    limit,
    offset,
    orderBy: [desc(appointmentDeposit.createdAt)],
  });

  // Get total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(appointmentDeposit)
    .where(whereClause);

  return ok({
    items,
    total,
    limit,
    offset,
  });
};

/**
 * List deposits with filters
 */
export const listDeposits = (db: DbConnection, input: ListDepositsInput) =>
  trackedResult(
    'appointments.listDeposits',
    () => withOrgScope((tx) => listDepositsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        appointmentId: input.appointmentId,
        status: input.status,
      },
    }
  );
