import { db } from '@borradh-workspace/database';
import {
  deleteOpeningHoursException,
  getEffectiveOpeningHours,
  updateStandingOpeningHours,
  upsertOpeningHoursException,
} from '@borradh-workspace/features/location-opening-hours';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard, CurrentUser } from '../common/index.js';
import {
  GetEffectiveOpeningHoursDto,
  UpdateStandingOpeningHoursDto,
  UpsertOpeningHoursExceptionDto,
} from './dto/index.js';

@Controller('locations/:locationId/opening-hours')
@UseGuards(AuthGuard)
export class LocationOpeningHoursController {
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async getSchedule(
    @Param('locationId') locationId: string,
    @Query() dto: GetEffectiveOpeningHoursDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await getEffectiveOpeningHours(db, {
      organizationId,
      locationId,
      windowStart: dto.windowStart,
      windowEnd: dto.windowEnd,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put('standing')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateStanding(
    @Param('locationId') locationId: string,
    @Body() dto: UpdateStandingOpeningHoursDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await updateStandingOpeningHours(db, {
      organizationId,
      locationId,
      openingHours: dto.openingHours,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put('exceptions/:date')
  @UsePipes(new ValidationPipe({ transform: true }))
  async upsertException(
    @Param('locationId') locationId: string,
    @Param('date') date: string,
    @Body() dto: UpsertOpeningHoursExceptionDto,
    @CurrentUser('id') userId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await upsertOpeningHoursException(db, {
      organizationId,
      locationId,
      date,
      closed: dto.closed,
      fromMinutes: dto.fromMinutes ?? null,
      toMinutes: dto.toMinutes ?? null,
      note: dto.note ?? null,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete('exceptions/:date')
  async deleteException(
    @Param('locationId') locationId: string,
    @Param('date') date: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await deleteOpeningHoursException(db, {
      organizationId,
      locationId,
      date,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
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
