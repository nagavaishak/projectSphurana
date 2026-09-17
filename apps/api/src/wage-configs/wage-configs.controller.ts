import { db } from '@borradh-workspace/database';
import {
  getWageConfig,
  updateWageConfig,
} from '@borradh-workspace/features/scheduling';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard } from '../common/index.js';
import type { UpdateWageConfigDto } from './dto/index.js';

@Controller('wage-configs')
@UseGuards(AuthGuard)
export class WageConfigsController {
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

  @Get(':practitionerId')
  async findOne(
    @Param('practitionerId') practitionerId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getWageConfig(db, { organizationId, practitionerId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':practitionerId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('practitionerId') practitionerId: string,
    @Body() dto: UpdateWageConfigDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateWageConfig(db, {
      ...dto,
      organizationId,
      practitionerId,
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
