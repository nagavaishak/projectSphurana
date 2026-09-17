import { patientAuth as patientAuthInstance } from '@borradh-workspace/auth/patient';
import { withSystemScope } from '@borradh-workspace/database';
import type { DbConnection } from '../../../shared/index.js';
import { findOrgBySlug } from '../shared/lookups.js';
import { ensurePortalMembershipByEmail } from '../shared/membership.js';

/**
 * TEST-ONLY. Mint a RETRIEVABLE sign-in OTP for an eligible lead, so an E2E
 * suite can complete the OTP flow without reading the (hashed) emailed code.
 * Uses Better Auth's server-only `createVerificationOTP` (no HTTP route), which
 * returns the raw code even when `storeOTP: 'hashed'`.
 *
 * SECURITY: this returns a live sign-in credential. It is reachable ONLY via
 * `POST /testing/patient-otp`, which is behind `DestructiveTestingGuard` (seed
 * token AND non-production). Never call it from a production code path.
 */
export const issuePatientTestOtp = (
  db: DbConnection,
  input: { email: string; organizationSlug: string }
): Promise<{ otp: string } | null> =>
  withSystemScope(
    async (tx) => {
      const email = input.email.trim().toLowerCase();
      const org = await findOrgBySlug(tx, input.organizationSlug);
      if (!org) return null;
      const membership = await ensurePortalMembershipByEmail(tx, org.id, email);
      if (!membership) return null;
      const otp = await patientAuthInstance.api.createVerificationOTP({
        body: { email, type: 'sign-in' },
      });
      return { otp: typeof otp === 'string' ? otp : String(otp) };
    },
    { db }
  );
