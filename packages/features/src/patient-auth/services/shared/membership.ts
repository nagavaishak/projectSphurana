import { lead, patientAuth } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../../shared/index.js';
import {
  findLeadByEmail,
  findOrCreateCustomerAccount,
  findOrCreatePatientAuthMembership,
} from './lookups.js';

/**
 * The identity + membership triple the patient BA instance needs to exist
 * BEFORE it is asked to sign a lead in. `disableSignUp: true` on the instance
 * means BA never mints a `customer_account` (user) from an unknown email — the
 * domain layer pre-creates it here, and ONLY for a lead that genuinely exists
 * at the clinic. That is the non-enumeration gate: an email with no lead at
 * this org resolves to `null` and BA is never called.
 */
export interface EnsuredMembership {
  customerAccountId: string;
  leadId: string;
  patientAuthId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Whether this caller is allowed to RE-POINT an existing membership at a
 * different customer account.
 *
 * `lead.email` is the source of truth for who a person is, so when it changes
 * the membership has to follow. But re-pointing it is an identity transfer,
 * and it was reachable from `request-otp` — an UNAUTHENTICATED endpoint. That
 * made `lead.email` an account-takeover primitive for any flow able to change
 * it without proving ownership of the new address.
 *
 * (The audit found no such flow today: the public booking form matches on
 * email and only touches `status`, imports never write email on update, and
 * the voice/campaign paths write status fields. `updateLead` is staff-only.
 * So this is closing the shape, not a live hole.)
 *
 * Requesting a code needs only to know a lead EXISTS — it mutates nothing.
 * The transfer happens once the code is verified and mailbox control is
 * proven.
 */
export type MembershipRelink = 'after-proof-only' | 'allowed';

const ensure = async (
  tx: DbConnection,
  leadRow: typeof lead.$inferSelect,
  relink: MembershipRelink
): Promise<EnsuredMembership | null> => {
  const email = leadRow.email;
  if (!email) return null; // can't sign in a lead with no email
  const account = await findOrCreateCustomerAccount(tx, email);
  const membership = await findOrCreatePatientAuthMembership(tx, {
    leadId: leadRow.id,
    organizationId: leadRow.organizationId,
    customerAccountId: account.id,
    relink: relink === 'allowed',
  });
  return {
    customerAccountId: account.id,
    leadId: leadRow.id,
    patientAuthId: membership.id,
    email: account.email,
    firstName: leadRow.firstName,
    lastName: leadRow.lastName,
  };
};

/**
 * Ensure the identity+membership for an EMAIL at an org (OTP path).
 *
 * `relink` defaults to `after-proof-only`: requesting a code must not move an
 * identity, because that endpoint is unauthenticated. `verify-otp` passes
 * `allowed` once the code has proven the caller controls the mailbox.
 */
export const ensurePortalMembershipByEmail = async (
  tx: DbConnection,
  organizationId: string,
  email: string,
  relink: MembershipRelink = 'after-proof-only'
): Promise<EnsuredMembership | null> => {
  const leadRow = await findLeadByEmail(tx, organizationId, email);
  if (!leadRow) return null;
  return ensure(tx, leadRow, relink);
};

/** Ensure the identity+membership for a LEAD at an org (staff mint path). */
export const ensurePortalMembershipByLead = async (
  tx: DbConnection,
  organizationId: string,
  leadId: string
): Promise<EnsuredMembership | null> => {
  const leadRow = await tx.query.lead.findFirst({
    where: and(
      eq(lead.id, leadId),
      eq(lead.organizationId, organizationId),
      notDeleted(lead)
    ),
  });
  if (!leadRow) return null;
  // Staff mint: the clinic is asserting this person's identity from their own
  // records, which is the same authority that set the email in the first
  // place.
  return ensure(tx, leadRow, 'allowed');
};

export interface ResolvedPatientPrincipal {
  patientAuthId: string;
  leadId: string;
  organizationId: string;
}

/**
 * Resolve a signed-in BA user (customer_account) to its `patient_auth`
 * membership at a specific clinic. The guard calls this after BA validates the
 * session AND after the org-pin check — a session with no membership at the
 * requested org resolves to `null` (→ generic 401).
 */
export const resolvePatientPrincipal = async (
  tx: DbConnection,
  customerAccountId: string,
  organizationId: string
): Promise<ResolvedPatientPrincipal | null> => {
  const membership = await tx.query.patientAuth.findFirst({
    where: and(
      eq(patientAuth.customerAccountId, customerAccountId),
      eq(patientAuth.organizationId, organizationId)
    ),
    // Explicit ordering, even though `uq_patient_auth_account_org` (0137) now
    // guarantees at most one row. An unordered findFirst is what made this
    // non-deterministic while duplicate leads each carried a membership: the
    // customer's bookings appeared and disappeared between page loads, which
    // is unreproducible and so near-impossible to act on from a support
    // ticket. Belt to the constraint's braces — if the constraint is ever
    // dropped this degrades to "stable but arbitrary", not back to flapping.
    orderBy: (row, { asc }) => [asc(row.createdAt), asc(row.id)],
  });
  if (!membership) return null;
  return {
    patientAuthId: membership.id,
    leadId: membership.leadId,
    organizationId: membership.organizationId,
  };
};
