import { form, formServiceRequirement } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  type Result,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetServiceIntakeFormsInput,
  type ServiceIntakeFormLink,
  getServiceIntakeFormsSchema,
} from './get-service-intake-forms.schema.js';

/**
 * The forms currently linked to a service — the read that lets the
 * attach-to-service dialog open PRE-POPULATED instead of blank (its counterpart,
 * set-service-intake-forms, is replace-the-set, so the UI needs to know the
 * current set to seed the checkboxes and blocksBooking toggles).
 *
 * Joins to `form` for the display name and drops links whose form has been
 * (soft-)deleted, so a retired form never shows as still attached.
 *
 * ── blocksBooking ────────────────────────────────────────────────────────────
 * `organization_service_intake_form` carried a `blocks_booking` flag;
 * `form_service_requirement` has NO such column — a row on it means, per its
 * name and its doc comment, "booking this service NEEDS this form". The unified
 * model has one linkage and it is a requirement.
 *
 * The wire field stays (the HTTP contract is unchanged by this storage swap) and
 * reports `true` for every link. That preserves the booking gate rather than
 * silently disabling it, at the cost of the old "attached but not blocking"
 * nice-to-have questionnaire, which the new table cannot express. Restoring it
 * needs a column on `form_service_requirement` — a migration, and therefore a
 * separate change.
 */
const getServiceIntakeFormsImpl = async (
  db: DbConnection,
  input: GetServiceIntakeFormsInput
): Promise<Result<{ forms: ServiceIntakeFormLink[] }>> => {
  const { organizationId, serviceId } =
    getServiceIntakeFormsSchema.parse(input);

  const rows = await db
    .select({
      intakeFormId: formServiceRequirement.formId,
      intakeFormName: form.name,
    })
    .from(formServiceRequirement)
    .innerJoin(form, eq(form.id, formServiceRequirement.formId))
    .where(
      and(
        eq(formServiceRequirement.organizationId, organizationId),
        eq(formServiceRequirement.serviceId, serviceId),
        eq(form.kind, 'intake'),
        notDeleted(form)
      )
    );

  return ok({
    forms: rows.map((row) => ({ ...row, blocksBooking: true })),
  }) as Result<{ forms: ServiceIntakeFormLink[] }>;
};

export const getServiceIntakeForms = (
  db: DbConnection,
  input: GetServiceIntakeFormsInput
) =>
  trackedResult(
    'intakeForms.getServiceIntakeForms',
    () => getServiceIntakeFormsImpl(db, input),
    { properties: { serviceId: input.serviceId } }
  );
export type GetServiceIntakeFormsResult = Awaited<
  ReturnType<typeof getServiceIntakeForms>
>;
