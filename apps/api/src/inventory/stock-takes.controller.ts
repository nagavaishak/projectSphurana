import { db } from '@borradh-workspace/database';
import {
  cancelStockTake,
  completeStockTake,
  createStockTake,
  getStockTake,
  listStockTakes,
  recordStockTakeCounts,
} from '@borradh-workspace/features/inventory';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
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
} from '../common';
import type {
  CreateStockTakeDto,
  ListStockTakesDto,
  RecordStockTakeCountsDto,
} from './dto';

@Controller('stock-takes')
@UseGuards(AuthGuard)
export class StockTakesController {
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
    @Query() dto: ListStockTakesDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listStockTakes(db, {
      ...dto,
      organizationId,
      locationId: activeLocationId ?? dto.locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getStockTake(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateStockTakeDto,
    @CurrentUser('id') userId: string,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createStockTake(db, {
      ...dto,
      organizationId,
      // `locationId` is REQUIRED on a stock take — you count one branch's
      // shelves. The body still wins; the header is what makes it optional
      // for a client that already knows which branch it is in.
      locationId: dto.locationId ?? activeLocationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id/items')
  @UsePipes(new ValidationPipe({ transform: true }))
  async recordCounts(
    @Param('id') id: string,
    @Body() dto: RecordStockTakeCountsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await recordStockTakeCounts(db, {
      stockTakeId: id,
      organizationId,
      items: dto.items,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/complete')
  async complete(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await completeStockTake(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await cancelStockTake(db, { id, organizationId });
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
