import { db } from '@borradh-workspace/database';
import { revokePatientSession } from '@borradh-workspace/features/patient-auth';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { PatientRequest } from '../common/guards/patient-auth.guard.js';
import { Public } from '../common/index.js';
import {
  clearPatientSessionCookie,
  readPatientSessionTokenFromRequest,
} from '../common/session/patient-session-cookie.js';

/**
 * Signing OUT is deliberately its own controller, with NO `PatientAuthGuard`.
 *
 * It used to sit on the guarded portal controller, and the guard 401s when
 * `X-Portal-Org` is missing or does not match the session's pin. So a client
 * that could not resolve its clinic slug — signing out from a route outside
 * `/portal/*`, or after the slug was cleared — was refused, and the
 * consequence of that refusal was that the session was NEVER REVOKED
 * server-side and the cookie never cleared. Only the local token was dropped,
 * while a 30-day session stayed live in `patient_session`.
 *
 * Requiring proof of WHICH clinic you are signing out of, in order to let you
 * sign out at all, is backwards: the worst case for an unauthenticated logout
 * is that someone destroys a session they already hold the token for, which
 * is precisely what the endpoint is for.
 *
 * The token still has to be presented — an unauthenticated caller with no
 * token revokes nothing — and revocation is best-effort: whether or not it
 * succeeds, the cookie is cleared, so a failure can never strand a browser
 * that looks signed in.
 */
@Controller('patient')
export class PatientLogoutController {
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: PatientRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body?: { everywhere?: boolean }
  ) {
    const token = readPatientSessionTokenFromRequest(req);
    if (token) {
      await revokePatientSession(db, {
        sessionToken: token,
        // Opt-in. Sessions last 30 days and are capped at 10, so a customer
        // who suspects a device or their mailbox is compromised otherwise had
        // no way to invalidate the other nine.
        scope: body?.everywhere === true ? 'everywhere' : 'this-device',
      });
    }
    clearPatientSessionCookie(res);
    return { success: true };
  }
}
