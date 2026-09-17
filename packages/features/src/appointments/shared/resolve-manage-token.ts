import {
  type Appointment,
  type Organization,
  appointment,
  appointmentManageToken,
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
import { hashManageToken } from './manage-token.js';

export interface ResolvedManagedAppointment {
  org: Organization;
  appointment: Appointment;
}

/**
 * (organizationSlug, rawToken) → the appointment it grants access to.
 *
 * This is the trust boundary for the whole self-serve flow: everything
 * downstream assumes an anonymous caller who reaches this point is entitled to
 * act on the returned appointment. Three things make that safe:
 *
 *  1. The slug bootstrap gives us org context BEFORE any appointment row is
 *     touched, so `org_isolation` is live for the token lookup itself. A token
 *     minted for org A cannot resolve while scoped to org B — the row is simply
 *     invisible.
 *  2. We look the token up BY HASH. The raw token never hits the database, so
 *     it cannot leak via query logs or a table dump.
 *  3. Expiry is enforced here, once, rather than in each of the three callers —
 *     the place a check gets forgotten is the fourth caller someone adds later.
 *
 * Every failure returns the SAME `NOT_FOUND`. Distinguishing "no such token"
 * from "expired token" from "wrong org" would hand an attacker an oracle, and
 * buys the honest patient nothing — the page says "this link is no longer
 * valid" either way.
 */
export const resolveManageToken = async (
  db: DbConnection,
  input: { organizationSlug: string; token: string }
): Promise<Result<ResolvedManagedAppointment>> => {
  const { organizationSlug, token } = input;

  const notValid = () =>
    err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'This booking link is no longer valid'
      )
    );

  if (!organizationSlug || !token) return notValid();

  // ── Slug bootstrap (OUTSIDE withPublicOrgScope) ───────────────────────────
  // Resolves slug → org id with no org context set, via the slug_bootstrap
  // policy on `organization`. See get-general-booking-config for the full note.
  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.slug, organizationSlug),
      notDeleted(organization)
    ),
  });

  if (!org) return notValid();

  // ── Scoped reads (INSIDE withPublicOrgScope) ──────────────────────────────
  // Always pass { db } so the helper uses the injected connection (app_public
  // pool / test mock), not the global default pool.
  const resolved = await withPublicOrgScope(
    org.id,
    async (tx) => {
      const row = await tx.query.appointmentManageToken.findFirst({
        where: and(
          eq(appointmentManageToken.organizationId, org.id),
          eq(appointmentManageToken.tokenHash, hashManageToken(token))
        ),
      });

      if (!row || row.expiresAt.getTime() <= Date.now()) return null;

      const appt = await tx.query.appointment.findFirst({
        where: and(
          eq(appointment.id, row.appointmentId),
          eq(appointment.organizationId, org.id),
          notDeleted(appointment)
        ),
      });

      return appt ?? null;
    },
    { db }
  );

  if (!resolved) return notValid();

  return ok({ org, appointment: resolved });
};
