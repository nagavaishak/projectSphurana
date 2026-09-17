import { db } from '@borradh-workspace/database';
import {
  deleteShiftOverride,
  listShifts,
  setShiftOverride,
  setWeeklyShifts,
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
} from '../common/index.js';
import type {
  ListShiftsDto,
  SetShiftOverrideDto,
  SetWeeklyShiftsDto,
} from './dto/index.js';

@Controller('shifts')
@UseGuards(AuthGuard)
export class ShiftsController {
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
    @Query() dto: ListShiftsDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    // Shifts already had a `?locationId=` query filter. The header WINS when
    // present: it is the branch the user is actually in, and it is the only
    // one of the two that has been validated against the active org.
    const result = await listShifts(db, {
      ...dto,
      organizationId,
      locationId: activeLocationId ?? dto.locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put('weekly/:practitionerId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setWeekly(
    @Param('practitionerId') practitionerId: string,
    @Body() dto: SetWeeklyShiftsDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await setWeeklyShifts(db, {
      ...dto,
      organizationId,
      practitionerId,
      // The rota being edited belongs to the branch being viewed. An explicit
      // body value still wins — the weekly-shifts editor sends one.
      // `undefined` = not sent (fall back to the active branch); an explicit
      // `null` means "all branches" and must survive.
      locationId:
        dto.locationId === undefined ? activeLocationId : dto.locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put('override/:practitionerId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setOverride(
    @Param('practitionerId') practitionerId: string,
    @Body() dto: SetShiftOverrideDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await setShiftOverride(db, {
      ...dto,
      organizationId,
      practitionerId,
      // `undefined` = not sent (fall back to the active branch); an explicit
      // `null` means "all branches" and must survive.
      locationId:
        dto.locationId === undefined ? activeLocationId : dto.locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete('override/:practitionerId/:date')
  async removeOverride(
    @Param('practitionerId') practitionerId: string,
    @Param('date') date: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteShiftOverride(db, {
      organizationId,
      practitionerId,
      date,
    });
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
