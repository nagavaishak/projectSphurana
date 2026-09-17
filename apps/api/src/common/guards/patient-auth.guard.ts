import { db } from '@borradh-workspace/database';
import { validatePatientSession } from '@borradh-workspace/features/patient-auth';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { readPatientSessionTokenFromRequest } from '../session/patient-session-cookie.js';

/**
 * Header carrying the clinic slug the portal is acting at. Portal v2: the
 * session is the PERSON (`customer_account`), silently linked across clinics
 * — WHICH clinic a request concerns must come from the client per request
 * (`patientFetch` sets it from the current portal route).
 */
export const PORTAL_ORG_HEADER = 'x-portal-org';

/** The signed-in PATIENT (the clinic's customer) — resolved from the session. */
export interface PatientPrincipal {
  patientAuthId: string;
  leadId: string;
  organizationId: string;
  /** The universal (cross-clinic) identity behind this per-org membership. */
  customerAccountId: string;
}

/** Request shape after PatientAuthGuard has run. */
export interface PatientRequest extends Request {
  patient: PatientPrincipal;
}

/**
 * Patient portal guard (ENG-647 / Portal v2) — parallel to `AuthGuard`, but
 * for the clinic's CUSTOMERS, not staff. Deliberately does NOT touch Better
 * Auth: it reads the `borradh_patient_session` httpOnly cookie (or bearer)
 * plus the `X-Portal-Org` slug header, validates them against
 * `patient_session` → `customer_account` → the `patient_auth` membership at
 * that clinic, and attaches the per-org principal to `request.patient`.
 *
 * The header is REQUIRED: without a clinic context there is no membership to
 * resolve, and defaulting one silently would let a session at clinic A be
 * replayed against clinic B. A valid session with no membership at the named
 * clinic is rejected with the same generic 401 as a bad token.
 *
 * Downstream reads for the patient run under `withPatientScope` using these
 * ids — the guard is the trust boundary that makes that scope's lead id
 * server-derived rather than client-supplied.
 */
@Injectable()
export class PatientAuthGuard implements CanActivate {
  private readonly logger = new Logger(PatientAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PatientRequest>();

    const token = readPatientSessionTokenFromRequest(request);
    if (!token) {
      throw new UnauthorizedException('Patient authentication required');
    }

    const rawOrgHeader = request.headers[PORTAL_ORG_HEADER];
    const organizationSlug = Array.isArray(rawOrgHeader)
      ? rawOrgHeader[0]
      : rawOrgHeader;
    if (!organizationSlug) {
      throw new UnauthorizedException('Patient authentication required');
    }

    const result = await validatePatientSession(db, {
      sessionToken: token,
      organizationSlug,
    });
    if (!result.success) {
      // Routine (expired cookie); debug-level so it doesn't spam BetterStack.
      this.logger.debug(
        `Patient session rejected: ${result.error.code} path=${request.originalUrl ?? request.url}`
      );
      throw new UnauthorizedException('Invalid or expired session');
    }

    request.patient = {
      patientAuthId: result.data.patientAuthId,
      leadId: result.data.leadId,
      organizationId: result.data.organizationId,
      customerAccountId: result.data.customerAccountId,
    };

    return true;
  }
}
