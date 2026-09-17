import {
  customerAccount,
  lead,
  organization,
  patientAuth,
} from '@borradh-workspace/database';
import { and, eq, sql } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../../shared/index.js';

/**
 * Canonical email comparison form. Bookings create leads with whatever case
 * the patient typed (`John.Smith@…`), so matching must be case-insensitive or
 * a differently-cased sign-in attempt misses the lead entirely. Trim +
 * lowercase everywhere email is compared, and lowercase before every insert
 * (`customer_account.email` is stored lowercase by contract).
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

/**
 * Resolve a public organization slug to the org row (mirrors the booking-forms
 * slug bootstrap — see submit-general-booking.service.ts).
 */
export const findOrgBySlug = (db: DbConnection, organizationSlug: string) =>
  db.query.organization.findFirst({
    where: and(
      eq(organization.slug, organizationSlug),
      notDeleted(organization)
    ),
  });

/**
 * Find the canonical person record for (org, email), case-insensitively.
 * Callers should still pass a normalized email, but the LOWER() compare makes
 * the match robust against mixed-case rows already in the table.
 */
export const findLeadByEmail = (
  db: DbConnection,
  organizationId: string,
  email: string
) =>
  db.query.lead.findFirst({
    where: and(
      eq(lead.organizationId, organizationId),
      sql`lower(${lead.email}) = ${normalizeEmail(email)}`,
      notDeleted(lead)
    ),
  });

/**
 * Find-or-create the universal `customer_account` for an email (Portal v2:
 * one email = one account, silently linked across clinics).
 *
 * Email is normalized before both the lookup and the insert — the UNIQUE
 * constraint on `customer_account.email` assumes lowercase storage.
 *
 * RACE. SELECT-then-INSERT has a window, and 0137 added
 * `uq_customer_account_email_lower`, which turned the loser of that race from
 * "quietly created a duplicate row" into a 23505. The previous note here said
 * the violation surfaces "in the caller's catch" — it does not: every caller
 * runs inside `withSystemScope`, i.e. a real transaction, and a raised 23505
 * aborts it, so there is nothing left to recover with. The whole request 500s
 * with a generic message.
 *
 * `ON CONFLICT DO NOTHING` is therefore the only shape that works here: no
 * error is raised, the transaction stays usable, and the winner's row is read
 * back. The insert blocks until the other transaction commits, so the re-read
 * sees it.
 */
export const findOrCreateCustomerAccount = async (
  db: DbConnection,
  email: string
): Promise<typeof customerAccount.$inferSelect> => {
  const normalized = normalizeEmail(email);
  const existing = await db.query.customerAccount.findFirst({
    where: eq(customerAccount.email, normalized),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(customerAccount)
    .values({ email: normalized })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost the race. The winner's row is the answer — one email is one account.
  const won = await db.query.customerAccount.findFirst({
    where: eq(customerAccount.email, normalized),
  });
  if (!won) {
    throw new Error(
      `customer_account for ${normalized} neither inserted nor found — the insert conflicted with a row that is not visible, which should be impossible`
    );
  }
  return won;
};

/**
 * Find-or-create the per-org `patient_auth` membership binding a lead to a
 * customer account.
 *
 * ONE MEMBERSHIP PER PERSON PER CLINIC, and the (customer_account,
 * organization) pair is what identifies it — not the lead.
 *
 * Duplicate leads are the normal state of a CRM: the same person books
 * online, then phones, then arrives as a walk-in, and Meta lead ads add a
 * fourth. Keyed on `lead_id` alone, each of those rows grew its own
 * membership, and `resolvePatientPrincipal` then picked between them with an
 * unordered `findFirst` — so the customer's bookings appeared and disappeared
 * between page loads, unreproducibly.
 *
 * Resolving the pair FIRST makes that impossible: every duplicate lead for
 * one person at one clinic converges on the membership that already exists,
 * and the DB constraint (0137) guarantees there is only ever one. Note the
 * consequence — the portal shows the lead the membership points at, not a
 * merge of all of them. Merging duplicate leads is a separate feature; being
 * STABLE is the fix here.
 *
 * The lead-keyed lookup stays as the second step, so the existing re-link
 * behaviour is unchanged: a membership whose lead's email now resolves to a
 * different account is re-pointed at that account.
 */
export const findOrCreatePatientAuthMembership = async (
  db: DbConnection,
  params: {
    leadId: string;
    organizationId: string;
    customerAccountId: string;
    /**
     * May this call RE-POINT an existing membership at a different account?
     *
     * False for `request-otp`, which is unauthenticated and only needs to know
     * a lead exists. See `MembershipRelink` in membership.ts.
     */
    relink: boolean;
  }
): Promise<typeof patientAuth.$inferSelect> => {
  // The person's membership at this clinic, whichever lead row it hangs off.
  const byIdentity = await db.query.patientAuth.findFirst({
    where: and(
      eq(patientAuth.customerAccountId, params.customerAccountId),
      eq(patientAuth.organizationId, params.organizationId)
    ),
  });
  if (byIdentity) return byIdentity;

  const existing = await db.query.patientAuth.findFirst({
    where: eq(patientAuth.leadId, params.leadId),
  });
  if (existing) {
    if (existing.customerAccountId === params.customerAccountId) {
      return existing;
    }
    // The lead's email now resolves to a different account. Moving the
    // membership is an identity transfer, so it waits for proof — an
    // unauthenticated caller gets the row as it stands, which is enough to
    // decide whether to send a code.
    if (!params.relink) return existing;
    const [relinked] = await db
      .update(patientAuth)
      .set({ customerAccountId: params.customerAccountId })
      .where(eq(patientAuth.id, existing.id))
      .returning();
    return relinked;
  }

  // Same race as findOrCreateCustomerAccount, against 0137's
  // `uq_patient_auth_account_org`: two concurrent sign-in attempts for one
  // person at one clinic both reach here having seen no membership. A raised
  // 23505 would abort the enclosing scope's transaction, so conflict-do-nothing
  // and re-read the row the winner wrote.
  const [created] = await db
    .insert(patientAuth)
    .values({
      leadId: params.leadId,
      organizationId: params.organizationId,
      customerAccountId: params.customerAccountId,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Re-read on the identity pair — the constraint that fired — not on leadId,
  // because the winner may have hung the membership off a DIFFERENT duplicate
  // lead for the same person. That is precisely the case this function exists
  // to converge.
  const won = await db.query.patientAuth.findFirst({
    where: and(
      eq(patientAuth.customerAccountId, params.customerAccountId),
      eq(patientAuth.organizationId, params.organizationId)
    ),
  });
  if (!won) {
    throw new Error(
      `patient_auth for account ${params.customerAccountId} at org ${params.organizationId} neither inserted nor found — the insert conflicted with a row that is not visible, which should be impossible`
    );
  }
  return won;
};
