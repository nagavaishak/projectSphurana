import { appointment, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import type { AppointmentWithRelations } from '../../models/index.js';
import { loadEffectiveDeposits } from '../../shared/effective-deposit.js';
import {
  type GetAppointmentInput,
  getAppointmentSchema,
} from './get-appointment.schema.js';

const getAppointmentImpl = async (
  db: DbConnection,
  input: GetAppointmentInput
): Promise<Result<AppointmentWithRelations>> => {
  const parsed = getAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const result = await db.query.appointment.findFirst({
    where: and(
      eq(appointment.id, parsed.data.id),
      eq(appointment.organizationId, parsed.data.organizationId),
      notDeleted(appointment)
    ),
    with: {
      lead: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      assignedTo: {
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  });

  if (!result) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Appointment not found'));
  }

  // Attach the effective deposit (paid > latest) so the detail view can show a
  // "Deposit paid €X" row + badge. Queried separately — appointment has no
  // deposit relation (would introduce a schema circular import).
  const deposits = await loadEffectiveDeposits(db, [result.id]);

  return ok({
    ...result,
    deposit: deposits.get(result.id) ?? null,
  } as AppointmentWithRelations);
};

export const getAppointment = (db: DbConnection, input: GetAppointmentInput) =>
  trackedResult(
    'appointments.getAppointment',
    () => withOrgScope((tx) => getAppointmentImpl(tx, input), { db }),
    {
      properties: { id: input.id },
      internalErrorsOnly: true,
    }
  );

export type GetAppointmentResult = Awaited<ReturnType<typeof getAppointment>>;
