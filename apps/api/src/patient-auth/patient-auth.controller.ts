import { db } from '@borradh-workspace/database';
import {
  requestOtp,
  verifyMagicLink,
  verifyOtp,
} from '@borradh-workspace/features/patient-auth';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/index.js';
import { setPatientSessionCookie } from '../common/session/patient-session-cookie.js';
import {
  RequestOtpDto,
  VerifyMagicLinkDto,
  VerifyOtpDto,
} from './dto/index.js';

/**
 * Public (unauthenticated) patient-portal auth routes (ENG-647 / Portal v2).
 *
 * The clinic's CUSTOMERS, not staff — a second principal type entirely
 * separate from Better Auth, and PASSWORDLESS: email OTP for direct sign-in,
 * magic link when the clinic shares access. Success responses set the
 * httpOnly `borradh_patient_session` cookie AND return the token in the
 * body: same-site deploys use the cookie; local Vite and native (cross-site
 * to the API, where the cookie doesn't flow) store the body token and send it
 * as `Authorization: Bearer` — mirroring the staff `X-Client-Type: mobile`
 * pattern.
 *
 * All handlers run on the system-scoped patient-auth services (auth flows
 * are pre-session by nature, mirroring Better Auth on the system
 * connection); per-route @Throttle bounds abuse on this public surface.
 */
// Open on purpose: these ARE the pre-session credential endpoints (a patient
// has no session until a code/link exchange succeeds). Abuse is bounded by the
// per-route @Throttle limits below, and none of them leaks account existence.
@Public()
@Controller('public/patient-auth')
export class PatientAuthController {
  @Post('request-otp')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @UsePipes(new ValidationPipe({ transform: true }))
  async requestOtp(@Body() dto: RequestOtpDto) {
    // Always 202 with the SAME body whether or not the email matched a
    // patient — the service guarantees no-enumeration (unknown emails mint
    // and send NOTHING but return the identical neutral shape, with
    // `expiresAt` computed uniformly).
    const result = await requestOtp(db, dto);
    if (!result.success) throw this.mapError(result.error);
    return { accepted: true, expiresAt: result.data.expiresAt };
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UsePipes(new ValidationPipe({ transform: true }))
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response
  ) {
    // Every credential failure is the same generic 401 ("That code didn't
    // work or has expired.") — anything more specific is an
    // account-enumeration oracle. The 5-attempts-per-token cap lives in the
    // service, on the token row itself.
    const result = await verifyOtp(db, dto);
    if (!result.success) throw this.mapError(result.error);

    setPatientSessionCookie(res, result.data.sessionToken);
    return {
      token: result.data.sessionToken,
      expiresAt: result.data.expiresAt,
      patient: result.data.patient,
    };
  }

  @Post('verify-magic-link')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UsePipes(new ValidationPipe({ transform: true }))
  async verifyMagicLink(
    @Body() dto: VerifyMagicLinkDto,
    @Res({ passthrough: true }) res: Response
  ) {
    // Single-use: the service consumes the token atomically, so a replayed
    // link gets the same generic failure as an unknown one.
    const result = await verifyMagicLink(db, dto);
    if (!result.success) throw this.mapError(result.error);

    setPatientSessionCookie(res, result.data.sessionToken);
    return {
      token: result.data.sessionToken,
      expiresAt: result.data.expiresAt,
      patient: result.data.patient,
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
