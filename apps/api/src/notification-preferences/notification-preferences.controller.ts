import { db } from '@borradh-workspace/database';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '@borradh-workspace/features/notification-preferences';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard, CurrentUser, SkipPaidPlanCheck } from '../common';
import { UpdateNotificationPreferencesDto } from './dto/index.js';

@Controller('notification-preferences')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class NotificationPreferencesController {
  @Get()
  async get(@CurrentUser('id') userId: string) {
    const result = await getNotificationPreferences(db, { userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put()
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser('id') userId: string
  ) {
    const result = await updateNotificationPreferences(db, {
      ...dto,
      userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
