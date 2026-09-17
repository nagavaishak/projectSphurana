import { db } from '@borradh-workspace/database';
import {
  buildPortalAccessUrl,
  mintMagicLink,
  resolveMicrositeLinkTarget,
} from '@borradh-workspace/features/patient-auth';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  RequireRole,
  RoleGuard,
} from '../common/index.js';

/**
 * STAFF-side portal access (Portal v2) — guarded by `AuthGuard`, never
 * `PatientAuthGuard`: the caller is a clinic member sharing access with a
 * patient, and the lead is scoped to THEIR active org inside the service.
 *
 * The response URL is a DIRECT SIGN-IN link (single-use magic_link token,
 * 24-hour TTL) — the UI's "Copy portal link" button warns as much on copy.
 * The raw token exists only in this response; the DB holds its hash.
 */
@Controller('patient-portal-access')
@UseGuards(AuthGuard, RoleGuard)
export class PatientPortalAccessController {
  /**
   * A CREDENTIAL-ISSUING endpoint: it returns a working sign-in URL for
   * another person. It was the only route in patient-auth with no throttle at
   * all, while all three PUBLIC ones had one — so a compromised or departing
   * staff account could script it across every lead in the org.
   *
   * `member` is the same bar as viewing a client's clinical record, which is
   * exactly what the link grants. Deliberately not owner-only: front-desk
   * staff legitimately send portal links, and setting the bar above them just
   * pushes clinics onto shared owner logins.
   */
  @Post(':leadId')
  @RequireRole('member')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async mint(
    @Param('leadId') leadId: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') actingUserId: string
  ) {
    const result = await mintMagicLink(db, {
      leadId,
      organizationId,
      actingUserId,
    });
    if (!result.success) throw this.mapError(result.error);

    // The tenant's own host when they have a live custom domain, ours
    // otherwise — one link, one lookup.
    const linkTarget = await resolveMicrositeLinkTarget(db, {
      id: organizationId,
      slug: result.data.organizationSlug,
    });

    return {
      url: buildPortalAccessUrl(linkTarget, result.data.token),
      expiresAt: result.data.expiresAt,
    };
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
