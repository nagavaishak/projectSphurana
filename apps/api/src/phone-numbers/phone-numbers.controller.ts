import { db } from '@borradh-workspace/database';
import { voiceEnv } from '@borradh-workspace/env/voice';
import {
  addPhoneNumber,
  buyPhoneNumber,
  listPhoneNumbers,
  releasePhoneNumber,
} from '@borradh-workspace/features/phone-numbers';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { createTelnyxService } from '@borradh-workspace/integrations';
import {
  Body,
  Controller,
  Delete,
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
import { ActiveOrganization, AdminGuard, AuthGuard } from '../common';
import type {
  AddPhoneNumberDto,
  BuyPhoneNumberDto,
  SearchAvailableNumbersDto,
} from './dto';

@Controller('phone-numbers')
@UseGuards(AuthGuard)
export class PhoneNumbersController {
  @Get()
  async findAll(@ActiveOrganization() organizationId: string) {
    const result = await listPhoneNumbers(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('available')
  @UsePipes(new ValidationPipe({ transform: true }))
  async searchAvailable(@Query() dto: SearchAvailableNumbersDto) {
    if (!voiceEnv.TELNYX_API_KEY) {
      throw new HttpException(
        'Phone number provisioning is not configured',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const telnyxService = createTelnyxService(voiceEnv.TELNYX_API_KEY);
    const numbers = await telnyxService.searchAvailableNumbers({
      countryCode: dto.countryCode,
      city: dto.city,
      state: dto.state,
      areaCode: dto.areaCode,
      limit: dto.limit,
    });

    return { items: numbers };
  }

  @Post('buy')
  @UseGuards(AdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async buy(
    @Body() dto: BuyPhoneNumberDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await buyPhoneNumber(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UseGuards(AdminGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async add(
    @Body() dto: AddPhoneNumberDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await addPhoneNumber(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async release(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await releasePhoneNumber(db, { id, organizationId });
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
      [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
