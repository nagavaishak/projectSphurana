import { db } from '@borradh-workspace/database';
import {
  type OrgDefaultsWithOverrides,
  getOrgDefaultsWithOverrides,
  updateOrgDefaults,
} from '@borradh-workspace/features/org-defaults';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Patch,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  RequireRole,
  RoleGuard,
} from '../common/index.js';
import { UpdateOrgDefaultsDto } from './dto/index.js';

@Controller('org-defaults')
@UseGuards(AuthGuard, RoleGuard)
export class OrgDefaultsController {
  private readonly logger = new Logger(OrgDefaultsController.name);

  /**
   * GET /org-defaults
   *
   * Returns the resolved defaults (system fallbacks fill in any unset
   * values) plus an `overrides` map indicating which fields are
   * org-specific vs system. The overrides map is computed inside the
   * features service so the controller stays free of direct DB access.
   */
  @Get()
  async findOne(
    @ActiveOrganization() organizationId: string
  ): Promise<OrgDefaultsWithOverrides> {
    const result = await getOrgDefaultsWithOverrides(db, { organizationId });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * PATCH /org-defaults
   *
   * Accepts a partial patch. Any key set to `null` clears the org-level
   * override for that field (read time falls back to the system default).
   * Omitted keys are untouched. Returns the new resolved defaults so the
   * frontend can drop the response straight into its query cache.
   */
  @Patch()
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ActiveOrganization() organizationId: string,
    @Body() dto: UpdateOrgDefaultsDto
  ): Promise<OrgDefaultsWithOverrides> {
    const result = await updateOrgDefaults(db, { ...dto, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Update org defaults failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return this.findOne(organizationId);
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
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
