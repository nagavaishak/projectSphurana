import { db } from '@borradh-workspace/database';
import {
  adjustGiftCard,
  getGiftCard,
  listGiftCards,
} from '@borradh-workspace/features/gift-cards';
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
import {
  ActiveLocation,
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
} from '../common';
import type { AdjustGiftCardDto, ListGiftCardsDto } from './dto';

@Controller('gift-cards')
@UseGuards(AuthGuard)
export class GiftCardsController {
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
    @Query() dto: ListGiftCardsDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listGiftCards(db, {
      ...dto,
      organizationId,
      locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('by-code/:code')
  async findByCode(
    @Param('code') code: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getGiftCard(db, { organizationId, code });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getGiftCard(db, { organizationId, giftCardId: id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/adjust')
  @UsePipes(new ValidationPipe({ transform: true }))
  async adjust(
    @Param('id') id: string,
    @Body() dto: AdjustGiftCardDto,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await adjustGiftCard(db, {
      ...dto,
      organizationId,
      giftCardId: id,
      createdById: userId,
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
