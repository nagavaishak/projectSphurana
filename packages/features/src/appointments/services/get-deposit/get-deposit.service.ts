import type { AppointmentDeposit } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
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
  type GetDepositInput,
  getDepositSchema,
} from './get-deposit.schema.js';

/**
 * Get deposit by ID or appointment ID
 */
const getDepositImpl = async (
  db: DbConnection,
  input: GetDepositInput
): Promise<Result<AppointmentDeposit>> => {
  const parsed = getDepositSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { depositId, appointmentId, organizationId } = parsed.data;

  let deposit: AppointmentDeposit | undefined;

  if (depositId) {
    deposit = await db.query.appointmentDeposit.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.id, depositId), eq(t.organizationId, organizationId)),
    });
  } else if (appointmentId) {
    deposit = await db.query.appointmentDeposit.findFirst({
      where: (t, { and, eq }) =>
        and(
          eq(t.appointmentId, appointmentId),
          eq(t.organizationId, organizationId)
        ),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
  }

  if (!deposit) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Deposit not found'));
  }

  return ok(deposit);
};

/**
 * Get deposit by ID or appointment ID
 */
export const getDeposit = (db: DbConnection, input: GetDepositInput) =>
  trackedResult(
    'appointments.getDeposit',
    () => withOrgScope((tx) => getDepositImpl(tx, input), { db }),
    {
      properties: {
        depositId: input.depositId,
        appointmentId: input.appointmentId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetDepositResult = Awaited<ReturnType<typeof getDeposit>>;
