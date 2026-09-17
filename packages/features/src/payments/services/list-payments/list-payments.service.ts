import {
  type Payment,
  payment,
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
  type ListPaymentsInput,
  listPaymentsSchema,
} from './list-payments.schema.js';

export interface ListPaymentsResult {
  items: Payment[];
  total: number;
  limit: number;
  offset: number;
}

const listPaymentsImpl = async (
  db: DbConnection,
  input: ListPaymentsInput
): Promise<Result<ListPaymentsResult>> => {
  const parsed = listPaymentsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId, status, limit, offset } = parsed.data;

  const conditions: SQL[] = [eq(payment.organizationId, organizationId)];

  if (leadId) {
    conditions.push(eq(payment.leadId, leadId));
  }

  if (status) {
    conditions.push(eq(payment.status, status));
  }

  const whereClause = and(...conditions);

  const [items, countResult] = await withOrgScope(
    async (tx) => {
      const rows = await tx.query.payment.findMany({
        where: whereClause,
        limit,
        offset,
        orderBy: [desc(payment.createdAt)],
      });
      const [ct] = await tx
        .select({ total: count() })
        .from(payment)
        .where(whereClause);
      return [rows, ct] as const;
    },
    { db }
  );

  return ok({
    items,
    total: countResult.total,
    limit,
    offset,
  });
};

export const listPayments = (db: DbConnection, input: ListPaymentsInput) =>
  trackedResult('payments.listPayments', () => listPaymentsImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      status: input.status,
    },
  });

export type ListPaymentsServiceResult = Awaited<
  ReturnType<typeof listPayments>
>;
