import { type Payment, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetPaymentInput,
  getPaymentSchema,
} from './get-payment.schema.js';

const getPaymentImpl = async (
  db: DbConnection,
  input: GetPaymentInput
): Promise<Result<Payment>> => {
  const parsed = getPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { paymentId, organizationId } = parsed.data;

  const result = await withOrgScope(
    (tx) =>
      tx.query.payment.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.id, paymentId), eq(t.organizationId, organizationId)),
      }),
    { db }
  );

  if (!result) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Payment not found'));
  }

  return ok(result);
};

export const getPayment = (db: DbConnection, input: GetPaymentInput) =>
  trackedResult('payments.getPayment', () => getPaymentImpl(db, input), {
    properties: {
      paymentId: input.paymentId,
      organizationId: input.organizationId,
    },
    internalErrorsOnly: true,
  });

export type GetPaymentResult = Awaited<ReturnType<typeof getPayment>>;
