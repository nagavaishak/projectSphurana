import {
  formServiceRequirement,
  formSubmission,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import {
  type GetOutstandingIntakeInput,
  type OutstandingIntake,
  getOutstandingIntakeSchema,
} from './get-outstanding-intake.schema.js';

/**
 * "Required forms block booking confirmation until completed."
 *
 * A submission blocks iff it is still `pending` AND the form it came from is
 * linked to a service as a requirement. A pending submission whose form is
 * linked to nothing (sent ad hoc) is counted but never blocks.
 *
 * This is a READ the confirmation flow consults; it does not itself change the
 * appointment. Keeping the gate as a derived check — rather than a status the
 * booking must transition through — means a form completed late simply unblocks
 * the booking with no state machine to unwind.
 *
 * `blocks_booking` no longer exists as a column: a row on
 * `form_service_requirement` IS the requirement. See the note in
 * get-service-intake-forms.service.ts — the practical effect is that a linked
 * form that used to be attached-but-not-blocking now blocks.
 */
const getOutstandingIntakeImpl = async (
  db: DbConnection,
  input: GetOutstandingIntakeInput
): Promise<Result<OutstandingIntake>> => {
  const { organizationId, appointmentId } =
    getOutstandingIntakeSchema.parse(input);

  const pending = await db
    .select({
      formId: formSubmission.formId,
      requirementId: formServiceRequirement.id,
    })
    .from(formSubmission)
    .leftJoin(
      formServiceRequirement,
      and(
        eq(formServiceRequirement.organizationId, organizationId),
        eq(formServiceRequirement.formId, formSubmission.formId)
      )
    )
    .where(
      and(
        eq(formSubmission.organizationId, organizationId),
        eq(formSubmission.appointmentId, appointmentId),
        eq(formSubmission.kind, 'intake'),
        eq(formSubmission.status, 'pending')
      )
    );

  const blockingCount = pending.filter((r) => r.requirementId != null).length;

  return ok({
    pendingCount: pending.length,
    blockingCount,
    isBlocked: blockingCount > 0,
  }) as Result<OutstandingIntake>;
};

export const getOutstandingIntake = (
  db: DbConnection,
  input: GetOutstandingIntakeInput
) =>
  trackedResult(
    'intakeForms.getOutstandingIntake',
    () => getOutstandingIntakeImpl(db, input),
    {
      properties: { appointmentId: input.appointmentId },
    }
  );
export type GetOutstandingIntakeResult = Awaited<
  ReturnType<typeof getOutstandingIntake>
>;
