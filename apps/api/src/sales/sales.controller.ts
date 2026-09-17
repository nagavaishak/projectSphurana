import { db } from '@borradh-workspace/database';
import {
  addSaleItem,
  addSalePayment,
  cancelSalePayment,
  completeSale,
  createSale,
  createSaleFromAppointment,
  getDailySummary,
  getSale,
  listSales,
  removeSaleItem,
  setSaleClient,
  setSaleTip,
  settleCardPayment,
  updateShopFulfilment,
  voidSale,
} from '@borradh-workspace/features/sales';
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
} from '../common';
import type {
  AddSaleItemDto,
  AddSalePaymentDto,
  CreateSaleDto,
  CreateSaleFromAppointmentDto,
  DailySummaryDto,
  ListSalesDto,
  SetSaleClientDto,
  SetSaleTipDto,
} from './dto';

@Controller('sales')
@UseGuards(AuthGuard)
export class SalesController {
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
    @Query() dto: ListSalesDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listSales(db, { ...dto, organizationId, locationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('daily-summary')
  @UsePipes(new ValidationPipe({ transform: true }))
  async dailySummary(
    @Query() dto: DailySummaryDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    // Daily summary already had a `?locationId=` filter; the validated header
    // wins over the query string when both are present.
    const result = await getDailySummary(db, {
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
    const result = await getSale(db, { saleId: id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateSaleDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createSale(db, {
      ...dto,
      organizationId,
      // A sale rings through one till, and which till is NOT the client's to
      // claim. The only source is the guard-validated `X-Location-Id` header —
      // it is stamped AFTER the spread so no body key can reach it. The
      // contract no longer declares `locationId`, and it is `.strict()`, so a
      // body carrying one is rejected before it gets here.
      locationId: activeLocationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('from-appointment')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createFromAppointment(
    @Body() dto: CreateSaleFromAppointmentDto,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createSaleFromAppointment(db, {
      ...dto,
      organizationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/items')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addItem(
    @Param('id') id: string,
    @Body() dto: AddSaleItemDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await addSaleItem(db, {
      ...dto,
      organizationId,
      saleId: id,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id/items/:itemId')
  async removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await removeSaleItem(db, {
      organizationId,
      saleId: id,
      itemId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id/tip')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setTip(
    @Param('id') id: string,
    @Body() dto: SetSaleTipDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await setSaleTip(db, {
      ...dto,
      organizationId,
      saleId: id,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id/client')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setClient(
    @Param('id') id: string,
    @Body() dto: SetSaleClientDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await setSaleClient(db, {
      ...dto,
      organizationId,
      saleId: id,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/payments')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addPayment(
    @Param('id') id: string,
    @Body() dto: AddSalePaymentDto,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await addSalePayment(db, {
      ...dto,
      organizationId,
      saleId: id,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/payments/:paymentId/settle-card')
  async settleCard(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await settleCardPayment(db, {
      organizationId,
      saleId: id,
      salePaymentId: paymentId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/payments/:paymentId/cancel')
  async cancelPayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await cancelSalePayment(db, {
      organizationId,
      saleId: id,
      salePaymentId: paymentId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/complete')
  async complete(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await completeSale(db, {
      organizationId,
      saleId: id,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/fulfilment/:status')
  async updateFulfilment(
    @Param('id') id: string,
    @Param('status') status: string,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    if (status !== 'ready' && status !== 'collected') {
      throw new HttpException(
        'Unknown fulfilment status',
        HttpStatus.BAD_REQUEST
      );
    }
    const result = await updateShopFulfilment(db, {
      organizationId,
      saleId: id,
      userId,
      status,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/void')
  async void(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await voidSale(db, { organizationId, saleId: id });
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
      [ErrorCodes.EXTERNAL_SERVICE_ERROR]: HttpStatus.BAD_GATEWAY,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
