import { db } from '@borradh-workspace/database';
import {
  createTimeOff,
  deleteTimeOff,
  listTimeOff,
  updateTimeOff,
} from '@borradh-workspace/features/scheduling';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveLocation,
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
} from '../common/index.js';
import type {
  CreateTimeOffDto,
  ListTimeOffDto,
  UpdateTimeOffDto,
} from './dto/index.js';

@Controller('time-off')
@UseGuards(AuthGuard)
export class TimeOffController {
  private requireActiveOrganization(
    organizationId: string | undefined
  ): string {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    return organizationId;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @Query() dto: ListTimeOffDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listTimeOff(db, {
      ...dto,
      organizationId,
      locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * NOTE — time off is deliberately NOT stamped with the active location, even
   * though the column exists and the plan's §3.2 says every create stamps one.
   *
   * Time off belongs to a PERSON, not a branch. Stamping the branch the
   * creator happened to be viewing would leave the practitioner looking
   * AVAILABLE at every other branch for the duration of their holiday, and the
   * availability resolver does not filter by location — so the calendar would
   * cheerfully double-book them. NULL (= all branches) is the only safe
   * default; a genuinely branch-specific absence needs an explicit UI, which
   * this phase does not build.
   */
  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateTimeOffDto,
    @CurrentUser('id') userId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createTimeOff(db, {
      ...dto,
      organizationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTimeOffDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateTimeOff(db, { ...dto, id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteTimeOff(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
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
      map[error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
