import { lead, withPatientScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetCurrentPatientInput,
  getCurrentPatientSchema,
} from './get-current-patient.schema.js';

/** The trimmed patient shape the portal sees — never the full lead row. */
export interface CurrentPatient {
  leadId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  organizationId: string;
  /**
   * The clinic's note TO this customer (`lead.portalNote`).
   *
   * Explicitly NOT `lead.notes` — that column is staff-internal commentary
   * written on the assumption no customer would ever read it, and mapping it
   * here would leak it for every existing record.
   */
  portalNote: string | null;
}

const getCurrentPatientImpl = async (
  tx: DbConnection,
  input: GetCurrentPatientInput
): Promise<Result<CurrentPatient>> => {
  // An EXPLICIT column list, not `findFirst` — that emits `select *`, and 0135
  // narrows `app_patient`'s grant on `lead` to exactly these columns, so a
  // star-select is "permission denied for column notes" at runtime. Keep this
  // list and the grant in step: widening one without the other fails loudly,
  // by design, rather than quietly handing the customer staff-internal
  // commentary (`lead.notes`), `metadata`, `tags` or CRM funnel state.
  //
  // Both predicates held explicitly so the read is correct even with RLS off,
  // matching every sibling patient read (list-bookings, list-documents, …).
  const [row] = await tx
    .select({
      id: lead.id,
      organizationId: lead.organizationId,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      portalNote: lead.portalNote,
    })
    .from(lead)
    .where(
      and(
        eq(lead.id, input.leadId),
        eq(lead.organizationId, input.organizationId)
      )
    )
    .limit(1);

  // With RLS on, the patient_self policy filters any row that is not the
  // signed-in patient's own — a filtered (or genuinely missing) row is a
  // NOT_FOUND, never someone else's record.
  if (!row) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Patient not found'));
  }

  return ok({
    leadId: row.id,
    firstName: row.firstName ?? null,
    lastName: row.lastName ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    organizationId: row.organizationId,
    portalNote: row.portalNote ?? null,
  });
};

/**
 * The Phase 0 proof-of-scope read: unlike the auth-flow services (system
 * scope), this runs under `withPatientScope` — the least-privilege
 * `app_patient` pool with `app.current_patient_lead_id` set — so the DB
 * itself guarantees a patient can only ever read their own row.
 */
export const getCurrentPatient = (
  db: DbConnection,
  input: GetCurrentPatientInput
) =>
  trackedResult(
    'patientAuth.getCurrentPatient',
    async () => {
      const parsed = getCurrentPatientSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      return withPatientScope(
        {
          leadId: parsed.data.leadId,
          organizationId: parsed.data.organizationId,
        },
        (tx) => getCurrentPatientImpl(tx, parsed.data),
        { db }
      );
    },
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetCurrentPatientResult = Awaited<
  ReturnType<typeof getCurrentPatient>
>;
