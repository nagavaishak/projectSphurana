import { db } from '@borradh-workspace/database';
import {
  getIntakeSubmission,
  submitIntakeForm,
} from '@borradh-workspace/features/intake-forms';
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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubmitIntakeFormDto } from './dto/index.js';

/**
 * Public (unauthenticated) intake fill-in routes.
 *
 * The token in the path IS the credential — the same bearer pattern as the
 * appointment manage link. Two consequences, mirrored from
 * PublicBookingController:
 *
 *  - The token is NEVER logged. Every log line records the slug only. A token
 *    in Better Stack is a working fill-in link for anyone with log access.
 *  - Throttled hard, per-IP. The token is 256 bits so brute force is hopeless,
 *    but a tight bound caps the damage if one ever leaks into a referrer.
 *
 * Rate limiting is enforced by the global FlyThrottlerGuard (APP_GUARD) keyed
 * on the real client IP; the per-route @Throttle limits below are what bound
 * abuse. We do NOT add a controller-level stock ThrottlerGuard (it keys on
 * Fly's rotating proxy IP and would bucket all public traffic together).
 */
@Controller('public/intake')
export class PublicIntakeController {
  private readonly logger = new Logger(PublicIntakeController.name);

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get(':organizationSlug/:token')
  async getSubmission(
    @Param('organizationSlug') organizationSlug: string,
    @Param('token') token: string
  ) {
    this.logger.log(`Get intake submission: org=${organizationSlug}`);

    const result = await getIntakeSubmission(db, { organizationSlug, token });

    if (!result.success) {
      this.logger.warn(
        `Get intake submission failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':organizationSlug/:token/submit')
  @UsePipes(new ValidationPipe({ transform: true }))
  async submit(
    @Param('organizationSlug') organizationSlug: string,
    @Param('token') token: string,
    @Body() dto: SubmitIntakeFormDto
  ) {
    this.logger.log(`Submit intake form: org=${organizationSlug}`);

    const result = await submitIntakeForm(db, {
      organizationSlug,
      token,
      answers: dto.answers,
    });

    if (!result.success) {
      this.logger.warn(
        `Submit intake form failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `Intake form submitted: submission=${result.data.submissionId}`
    );
    return result.data;
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
