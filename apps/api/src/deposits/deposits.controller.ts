import { db } from '@borradh-workspace/database';
import {
  cancelDeposit,
  createDepositRequest,
  getDeposit,
  listDeposits,
  refundDeposit,
} from '@borradh-workspace/features/appointments';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard } from '../common';
import type {
  CreateDepositDto,
  ListDepositsDto,
  RefundDepositDto,
} from './dto';

@Controller('deposits')
@UseGuards(AuthGuard)
export class DepositsController {
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

  /**
   * Create a deposit request for an appointment
   */
  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateDepositDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createDepositRequest(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Get a deposit by ID
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getDeposit(db, { depositId: id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Get deposit by appointment ID
   */
  @Get('appointment/:appointmentId')
  async findByAppointment(
    @Param('appointmentId') appointmentId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getDeposit(db, { appointmentId, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * List deposits with filters
   */
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @Query() dto: ListDepositsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listDeposits(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Cancel a pending deposit
   */
  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await cancelDeposit(db, { depositId: id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Refund a paid deposit
   */
  @Post(':id/refund')
  @UsePipes(new ValidationPipe({ transform: true }))
  async refund(
    @Param('id') id: string,
    @Body() dto: RefundDepositDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await refundDeposit(db, {
      depositId: id,
      organizationId,
      reason: dto.reason,
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
      [ErrorCodes.EXTERNAL_SERVICE_ERROR]: HttpStatus.BAD_GATEWAY,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
