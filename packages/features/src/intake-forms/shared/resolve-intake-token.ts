import {
  type FormSubmission,
  type Organization,
  formSubmission,
  organization,
  withPublicOrgScope,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../shared/index.js';
import { hashIntakeToken } from './intake-token.js';

/**
 * The columns of `form_submission` the PUBLIC (unauthenticated) intake pages
 * are allowed to see. This is deliberately a hand-written list rather than the
 * whole row.
 *
 * ⚠️ THE GRANT HAS NOT MOVED WITH THE READ. drizzle/0157_narrow_public_intake
 * _grants.sql gave `app_public` its column-level SELECT/UPDATE on
 * `intake_submission`; migration 0166 created `form_submission` with an RLS
 * POLICY for `app_public` but NO grant — and a policy without a grant is dead.
 * This read and the submit path therefore need, before `RLS_ENABLED` is turned
 * on for them:
 *
 *   GRANT SELECT (id, organization_id, form_id, kind, status, token_hash,
 *                 fields_snapshot, answers)      ON form_submission TO app_public;
 *   GRANT UPDATE (answers, status, completed_at, updated_at)
 *                                                ON form_submission TO app_public;
 *   GRANT SELECT (id, organization_id, kind, name, description)
 *                                                ON form            TO app_public;
 *
 * Postgres requires the privilege on every column a statement TOUCHES,
 * predicates included — hence `token_hash` and `kind` in the SELECT grant
 * although no caller reads either back.
 *
 * KEEP THE TWO IN STEP — see the header of
 * drizzle/0090_narrow_public_availability_grants.sql. Widening this selection
 * without widening the grant fails at RUNTIME with `permission denied for
 * column …`, not at build time, and only once `RLS_ENABLED` is on.
 *
 * Withheld on purpose: `lead_id` and `appointment_id` (pivots into the client's
 * wider file — a bearer link to one form is not a licence to enumerate the
 * patient record), plus `sent_at` / `created_at` / `updated_at`, which nothing
 * on the public path renders. `completed_at` is written by the submit path but
 * never read back by it, so it carries UPDATE without SELECT.
 *
 * `fields_snapshot` and `answers` ARE here and cannot be removed: the questions
 * are what the page renders and validates against, and the answers are what a
 * patient re-reads after signing. They stay legally significant data — the
 * protection for them is the token, not the grant.
 */
const PUBLIC_SUBMISSION_COLUMNS = {
  // Returned to the caller as `submissionId`, and the UPDATE's WHERE anchor.
  id: true,
  // Both the read's and the write's org predicate.
  organizationId: true,
  // getIntakeSubmission joins the live form for its (cosmetic) name.
  formId: true,
  // Both callers branch on it: pending vs already-completed.
  status: true,
  // The questions as asked — rendered, and validated against on submit.
  fieldsSnapshot: true,
  // Shown back to the patient once the form is completed.
  answers: true,
} as const;

/** The narrowed submission the public intake pages get. */
export type PublicIntakeSubmission = Pick<
  FormSubmission,
  keyof typeof PUBLIC_SUBMISSION_COLUMNS
>;

/**
 * (organizationSlug, rawToken) → the intake submission it grants access to.
 *
 * Same trust boundary and same three guarantees as the appointment manage-token
 * resolver: org context is bootstrapped from the slug BEFORE the submission is
 * probed (so org_isolation is live for the lookup), the token is matched by
 * hash (the raw value never touches the DB), and every failure returns the same
 * NOT_FOUND so an attacker gets no oracle.
 *
 * There is no expiry: a clinic may legitimately send an intake form weeks ahead,
 * and a form does not become dangerous with age the way a cancel link does. A
 * COMPLETED submission still resolves — the patient can review what they signed
 * — but the caller decides whether to allow re-submission.
 */
export const resolveIntakeToken = async (
  db: DbConnection,
  input: { organizationSlug: string; token: string }
): Promise<
  Result<{ org: Organization; submission: PublicIntakeSubmission }>
> => {
  const { organizationSlug, token } = input;

  const notValid = () =>
    err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'This form link is no longer valid'
      )
    );

  if (!organizationSlug || !token) return notValid();

  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.slug, organizationSlug),
      notDeleted(organization)
    ),
  });
  if (!org) return notValid();

  const submission = await withPublicOrgScope(
    org.id,
    (tx) =>
      tx.query.formSubmission.findFirst({
        // Explicit list, NOT `select *` — see PUBLIC_SUBMISSION_COLUMNS.
        columns: PUBLIC_SUBMISSION_COLUMNS,
        where: and(
          eq(formSubmission.organizationId, org.id),
          // The unified table also holds consent documents and clinical notes.
          // An intake token resolves an INTAKE submission and nothing else.
          eq(formSubmission.kind, 'intake'),
          eq(formSubmission.tokenHash, hashIntakeToken(token))
        ),
      }),
    { db }
  );

  if (!submission) return notValid();

  return ok({ org, submission });
};
