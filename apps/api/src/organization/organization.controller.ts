import { auth } from '@borradh-workspace/auth/server';
import { type OnboardingTask, db } from '@borradh-workspace/database';
import {
  completeOnboardingTask,
  getActiveOrganization,
  getOnboardingTasks,
  setActiveOrganization,
  updateOrganizationSettings,
} from '@borradh-workspace/features/organizations';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { onboardingTaskValues } from '@borradh-workspace/labels';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IsIn, IsString, MinLength } from 'class-validator';
import {
  AdminGuard,
  AuthGuard,
  CurrentUser,
  SessionToken,
  SkipPaidPlanCheck,
} from '../common';
import { unwrapResult } from '../common/unwrap-result.js';
import {
  readActiveOrganization,
  resolveActiveOrganizationId,
} from './active-organization.js';
import { UpdateOrganizationSettingsDto } from './dto/index.js';

/**
 * DTO for setting active organization
 */
class SetActiveOrganizationDto {
  @IsString()
  @MinLength(1, { message: 'Organization ID is required' })
  organizationId!: string;
}

/**
 * DTO for completing an onboarding task
 */
class CompleteOnboardingTaskDto {
  @IsString()
  @IsIn(onboardingTaskValues as unknown as string[], {
    message: 'Invalid task ID',
  })
  taskId!: OnboardingTask;
}

/**
 * Organization Controller
 *
 * Handles user-session-specific organization operations:
 * - GET /organization/active - Get current user's active organization
 * - POST /organization/active - Set current user's active organization
 * - GET /organizations - List current user's organizations (on OrganizationsController)
 */
@Controller('organization')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class OrganizationController {
  private readonly logger = new Logger(OrganizationController.name);

  /**
   * Bind this controller's logger + error mapper for `unwrapResult`. A
   * PROPERTY, not a method: Gate 5 counts every private method on a controller
   * as orchestration, and this holds none.
   */
  private readonly unwrapWith = (label: string) => ({
    logger: this.logger,
    label,
    mapError: (error: { code: string; message: string }) =>
      this.mapErrorToHttpException(error),
  });

  /** `resolveActiveOrganizationId` options that log the failure, as PATCH did. */
  private readonly resolveOpts = {
    mapError: (error: { code: string; message: string }) =>
      this.mapErrorToHttpException(error),
    logFailure: (error: { code: string; message: string }) =>
      this.logger.warn(
        `Get active organization failed: ${error.code} - ${error.message}`
      ),
  };

  /** Same, minus the WARN — the onboarding-task routes never logged it. */
  private readonly resolveOptsQuiet = {
    mapError: (error: { code: string; message: string }) =>
      this.mapErrorToHttpException(error),
  };

  /**
   * GET /organization/active
   * Get the current user's active organization
   */
  @Get('active')
  async getActive(
    @SessionToken() sessionToken: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await getActiveOrganization(auth.api, { sessionToken });

    if (!result.success) {
      this.logger.warn(
        `Get active organization failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    const org = result.data.organization;
    if (!org) return null;

    return readActiveOrganization(org, userId);
  }

  /**
   * POST /organization/active
   * Set the current user's active organization
   */
  @Post('active')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setActive(
    @SessionToken() sessionToken: string,
    @Body() body: SetActiveOrganizationDto
  ) {
    this.logger.log(`Setting active organization: ${body.organizationId}`);

    const result = await setActiveOrganization(auth.api, {
      sessionToken,
      organizationId: body.organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Set active organization failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `Active organization set successfully: ${result.data.organization.id}`
    );
    return result.data.organization;
  }

  /**
   * PATCH /organization/active
   * Update the current user's active organization settings
   */
  @Patch('active')
  @UseGuards(AdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateActive(
    @SessionToken() sessionToken: string,
    @Body() body: UpdateOrganizationSettingsDto
  ) {
    const organizationId = await resolveActiveOrganizationId(
      sessionToken,
      this.resolveOpts
    );

    const data = unwrapResult(
      await updateOrganizationSettings(db, { organizationId, ...body }),
      this.unwrapWith('Update organization settings')
    );

    this.logger.log(`Organization settings updated: ${organizationId}`);
    return data;
  }

  /**
   * GET /organization/onboarding-tasks
   * Get onboarding tasks with completion status for the active organization
   */
  @Get('onboarding-tasks')
  async getOnboardingTasksStatus(@SessionToken() sessionToken: string) {
    const organizationId = await resolveActiveOrganizationId(
      sessionToken,
      this.resolveOptsQuiet
    );

    return unwrapResult(
      await getOnboardingTasks(db, { organizationId }),
      this.unwrapWith('Get onboarding tasks')
    );
  }

  /**
   * POST /organization/onboarding-tasks/complete
   * Mark an onboarding task as completed for the active organization
   */
  @Post('onboarding-tasks/complete')
  @UsePipes(new ValidationPipe({ transform: true }))
  async completeOnboardingTaskStatus(
    @SessionToken() sessionToken: string,
    @Body() body: CompleteOnboardingTaskDto,
    @CurrentUser('email') userEmail: string
  ) {
    const organizationId = await resolveActiveOrganizationId(
      sessionToken,
      this.resolveOptsQuiet
    );

    const data = unwrapResult(
      await completeOnboardingTask(db, {
        organizationId,
        taskId: body.taskId,
        userEmail,
      }),
      this.unwrapWith('Complete onboarding task')
    );

    this.logger.log(
      `Onboarding task completed: ${body.taskId} for org ${organizationId}`
    );
    return data;
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
      case ErrorCodes.INVALID_STATE:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
