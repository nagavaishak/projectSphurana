import { creditBalances, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetCreditBalanceInput,
  getCreditBalanceSchema,
} from './get-credit-balance.schema.js';

/**
 * Internal implementation
 */
const getCreditBalanceImpl = async (
  db: DbConnection,
  input: GetCreditBalanceInput
): Promise<Result<typeof creditBalances.$inferSelect>> => {
  const parsed = getCreditBalanceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const balance = await withOrgScope(
    (tx) =>
      tx.query.creditBalances.findFirst({
        where: eq(creditBalances.organizationId, parsed.data.organizationId),
      }),
    { db }
  );

  if (!balance) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Credit balance not found')
    );
  }

  return ok(balance);
};

/**
 * Get credit balance for an organization
 */
export const getCreditBalance = (
  db: DbConnection,
  input: GetCreditBalanceInput
) =>
  trackedResult(
    'billing.getCreditBalance',
    () => getCreditBalanceImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetCreditBalanceResult = Awaited<
  ReturnType<typeof getCreditBalance>
>;
