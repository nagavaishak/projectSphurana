import { db } from '@borradh-workspace/database';
import {
  cancelStockOrder,
  createStockOrder,
  getStockOrder,
  listStockOrders,
  receiveStockOrder,
  updateStockOrder,
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
  CreateStockOrderDto,
  ListStockOrdersDto,
  ReceiveStockOrderDto,
  UpdateStockOrderDto,
} from './dto';

@Controller('stock-orders')
@UseGuards(AuthGuard)
export class StockOrdersController {
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
    @Query() dto: ListStockOrdersDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listStockOrders(db, {
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
    const result = await getStockOrder(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateStockOrderDto,
    @CurrentUser('id') userId: string,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createStockOrder(db, {
      ...dto,
      organizationId,
      // Stock is ordered INTO a branch. Body wins; header is the default.
      locationId: dto.locationId ?? activeLocationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStockOrderDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateStockOrder(db, { ...dto, id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/receive')
  @UsePipes(new ValidationPipe({ transform: true }))
  async receive(
    @Param('id') id: string,
    @Body() dto: ReceiveStockOrderDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await receiveStockOrder(db, {
      stockOrderId: id,
      organizationId,
      items: dto.items,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await cancelStockOrder(db, { id, organizationId });
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
