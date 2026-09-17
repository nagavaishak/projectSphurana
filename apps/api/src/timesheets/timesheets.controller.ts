import { db } from '@borradh-workspace/database';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  approveTimeEntry,
  clockIn,
  clockOut,
  deleteTimeEntry,
  endBreak,
  listTimeEntries,
  startBreak,
  updateTimeEntry,
} from '@borradh-workspace/features/timesheets';
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
  CanManageOthers,
  CurrentUser,
} from '../common';
import type {
  AddBreakDto,
  ClockInDto,
  ClockOutDto,
  ListTimeEntriesDto,
  UpdateTimeEntryDto,
} from './dto';

@Controller('time-entries')
@UseGuards(AuthGuard)
export class TimesheetsController {
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
    @Query() dto: ListTimeEntriesDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listTimeEntries(db, {
      ...dto,
      organizationId,
      locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('clock-in')
  @UsePipes(new ValidationPipe({ transform: true }))
  async clockIn(
    @Body() dto: ClockInDto,
    @CurrentUser('id') userId: string,
    @ActiveOrganization() orgId: string | undefined,
    @CanManageOthers() canManageOthers: boolean
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await clockIn(db, {
      ...dto,
      organizationId,
      requestingUserId: userId,
      canManageOthers,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/clock-out')
  @UsePipes(new ValidationPipe({ transform: true }))
  async clockOut(
    @Param('id') id: string,
    @Body() dto: ClockOutDto,
    @CurrentUser('id') userId: string,
    @ActiveOrganization() orgId: string | undefined,
    @CanManageOthers() canManageOthers: boolean
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await clockOut(db, {
      ...dto,
      timeEntryId: id,
      organizationId,
      requestingUserId: userId,
      canManageOthers,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/breaks')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addBreak(
    @Param('id') id: string,
    @Body() dto: AddBreakDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const input = { timeEntryId: id, organizationId, at: dto.at };
    const result =
      dto.type === 'start'
        ? await startBreak(db, input)
        : await endBreak(db, input);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTimeEntryDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateTimeEntry(db, {
      ...dto,
      timeEntryId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await approveTimeEntry(db, {
      timeEntryId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteTimeEntry(db, {
      timeEntryId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.INVALID_INPUT]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
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
