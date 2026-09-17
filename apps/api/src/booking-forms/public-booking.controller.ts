import { db } from '@borradh-workspace/database';
import {
  cancelManagedAppointment,
  getManagedAppointment,
  rescheduleManagedAppointment,
} from '@borradh-workspace/features/appointments';
import {
  getGeneralBookingConfig,
  getGeneralBookingSlots,
  listBookingLocations,
  submitGeneralBooking,
} from '@borradh-workspace/features/booking-forms';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/index.js';
import { GetGeneralBookingSlotsDto } from './dto/get-general-booking-slots.dto.js';
import {
  CancelManagedAppointmentDto,
  RescheduleManagedAppointmentDto,
} from './dto/manage-booking.dto.js';
import { SubmitGeneralBookingDto } from './dto/submit-general-booking.dto.js';

/**
 * Public (unauthenticated) booking routes.
 *
 * RLS note: this controller connects as the `app_public` Postgres role (wired
 * in Phase 2 / I3). Until that pool is wired, all calls fall through to the
 * shared `db` (owner role, bypasses RLS — behaviour is unchanged from pre-RLS).
 *
 * The `db` reference passed to each service function is the seam that Phase 2
 * will replace with the `app_public`-pool connection. Passing it explicitly
 * (rather than importing the global db inside the service) is why
 * `withPublicOrgScope` must receive `{ db }` in every service call — without
 * that, the helper falls back to the global pool and the pool separation is
 * lost. See docs/rls/rls-implementation-plan.md §1.
 */
// Rate limiting is enforced by the global FlyThrottlerGuard (APP_GUARD), which
// keys on the real client IP (X-Forwarded-For) rather than Fly's rotating proxy
// IP — so per-route @Throttle limits below are what actually bound abuse. We do
// NOT add a controller-level stock ThrottlerGuard: it keys on the wrong IP
// behind Fly and would bucket all public booking traffic together.
@Controller('public/booking')
export class PublicBookingController {
  private readonly logger = new Logger(PublicBookingController.name);

  // Config recomputes org/service data on each hit; bound per-IP.
  //
  // `locationSlug` is the branch the customer is booking at, and it is
  // OPTIONAL: absent means the org's default branch, which is exactly what
  // this endpoint served before branches existed — so single-location orgs and
  // any not-yet-updated caller are unaffected.
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(':organizationSlug')
  async getGeneralConfig(
    @Param('organizationSlug') organizationSlug: string,
    @Query('locationSlug') locationSlug?: string
  ) {
    this.logger.log(
      `Get general booking config: org=${organizationSlug}, location=${locationSlug ?? 'default'}`
    );

    // Pass the `db` reference so withPublicOrgScope inside the service uses
    // the injected connection (app_public pool after Phase 2 / I3 wiring).
    const result = await getGeneralBookingConfig(db, {
      organizationSlug,
      locationSlug,
    });

    if (!result.success) {
      throw this.handleError('Get general booking config', result.error);
    }

    return result.data;
  }

  /**
   * The branch chooser payload for `/sites/{orgSlug}/book`.
   *
   * `@Public()` because this controller has no AuthGuard: without the marker a
   * scanner cannot tell "deliberately open" from "nobody thought about it"
   * (see apps/api/src/architecture/entry-point-policy.ts).
   *
   * Throttled like `config` rather than like `slots`: it is two small scoped
   * reads with no external I/O, and it is the FIRST call of every public
   * booking session, so a tighter bound than the payload that follows it would
   * be the thing that breaks first. As on the routes around it, the global
   * FlyThrottlerGuard is what keys on the real client IP; this per-route limit
   * is what actually bounds abuse.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(':organizationSlug/locations')
  async listLocations(@Param('organizationSlug') organizationSlug: string) {
    this.logger.log(`List booking locations: org=${organizationSlug}`);

    const result = await listBookingLocations(db, { organizationSlug });

    if (!result.success) {
      throw this.handleError('List booking locations', result.error);
    }

    return result.data;
  }

  // Slots is the expensive endpoint (scoped DB reads + live Google free/busy).
  // A short server-side cache absorbs most load, but still bound per-IP tightly
  // to blunt cache-busting abuse (varying serviceId/practitionerId/date).
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get(':organizationSlug/slots')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getGeneralSlots(
    @Param('organizationSlug') organizationSlug: string,
    @Query() query: GetGeneralBookingSlotsDto
  ) {
    this.logger.log(
      `Get general booking slots: org=${organizationSlug}, service=${query.serviceId}, date=${query.date}, location=${query.locationSlug ?? 'default'}`
    );

    const result = await getGeneralBookingSlots(db, {
      organizationSlug,
      serviceId: query.serviceId,
      locationSlug: query.locationSlug,
      // The route asks for one calendar day; the service takes a window.
      startDate: new Date(`${query.date}T00:00:00`),
      endDate: new Date(`${query.date}T23:59:59`),
      practitionerId: query.practitionerId,
    });

    if (!result.success) {
      throw this.handleError('Get general booking slots', result.error);
    }

    return result.data;
  }

  @Post(':organizationSlug/submit')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UsePipes(new ValidationPipe({ transform: true }))
  async submitGeneral(
    @Param('organizationSlug') organizationSlug: string,
    @Body() submitDto: SubmitGeneralBookingDto
  ) {
    this.logger.log(
      `Submit general booking: org=${organizationSlug}, service=${submitDto.serviceId}, location=${submitDto.locationSlug ?? 'default'}`
    );

    const result = await submitGeneralBooking(db, {
      organizationSlug,
      ...submitDto,
    });

    if (!result.success) {
      this.logger.warn(
        `Submit general booking failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `General booking submitted successfully: appointment=${result.data.appointmentId}`
    );
    return result.data;
  }

  // ── Patient self-serve manage-booking ──────────────────────────────────────
  // The token in the path IS the credential. Two consequences:
  //
  //  - It must never be logged. Every log line below records the slug only.
  //    A token in Better Stack is a working cancel link for anyone with log
  //    access.
  //  - Throttled hard. The token is 256 bits so brute force is hopeless on
  //    paper, but a tight per-IP bound turns "hopeless" into "not even worth
  //    the attempt" and caps the damage if a token ever leaks into a referrer.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get(':organizationSlug/manage/:token')
  async getManagedBooking(
    @Param('organizationSlug') organizationSlug: string,
    @Param('token') token: string
  ) {
    this.logger.log(`Get managed booking: org=${organizationSlug}`);

    const result = await getManagedAppointment(db, {
      organizationSlug,
      token,
    });

    if (!result.success) {
      this.logger.warn(
        `Get managed booking failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':organizationSlug/manage/:token/cancel')
  @UsePipes(new ValidationPipe({ transform: true }))
  async cancelManagedBooking(
    @Param('organizationSlug') organizationSlug: string,
    @Param('token') token: string,
    @Body() dto: CancelManagedAppointmentDto
  ) {
    this.logger.log(`Cancel managed booking: org=${organizationSlug}`);

    const result = await cancelManagedAppointment(db, {
      organizationSlug,
      token,
      ...dto,
    });

    if (!result.success) {
      this.logger.warn(
        `Cancel managed booking failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `Managed booking cancelled: appointment=${result.data.appointmentId}`
    );
    return result.data;
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':organizationSlug/manage/:token/reschedule')
  @UsePipes(new ValidationPipe({ transform: true }))
  async rescheduleManagedBooking(
    @Param('organizationSlug') organizationSlug: string,
    @Param('token') token: string,
    @Body() dto: RescheduleManagedAppointmentDto
  ) {
    this.logger.log(`Reschedule managed booking: org=${organizationSlug}`);

    const result = await rescheduleManagedAppointment(db, {
      organizationSlug,
      token,
      ...dto,
    });

    if (!result.success) {
      this.logger.warn(
        `Reschedule managed booking failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `Managed booking rescheduled: appointment=${result.data.appointmentId}`
    );
    return result.data;
  }

  /** Log a failed use case, then hand back the exception for the caller to throw. */
  private handleError(label: string, error: { code: string; message: string }) {
    this.logger.warn(`${label} failed: ${error.code} - ${error.message}`);
    return this.mapErrorToHttpException(error);
  }

  private mapErrorToHttpException(error: { code: string; message: string }) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_INPUT:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case ErrorCodes.FORBIDDEN:
        return new HttpException(error.message, HttpStatus.FORBIDDEN);
      case ErrorCodes.NOT_FOUND:
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      case ErrorCodes.ALREADY_EXISTS:
      case ErrorCodes.CONFLICT:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
