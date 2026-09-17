import { db } from '@borradh-workspace/database';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerPushToken,
  unregisterPushToken,
} from '@borradh-workspace/features/notifications';
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
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../common';
import {
  ListNotificationsDto,
  RegisterPushTokenDto,
  UnregisterPushTokenDto,
} from './dto';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async list(
    @Query() dto: ListNotificationsDto,
    @CurrentUser('id') userId: string
  ) {
    const result = await listNotifications(db, { userId, ...dto });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser('id') userId: string) {
    const result = await getUnreadNotificationCount(db, { userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('read-all')
  async markAllRead(@CurrentUser('id') userId: string) {
    const result = await markAllNotificationsRead(db, { userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const result = await markNotificationRead(db, { id, userId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('push-token')
  @UsePipes(new ValidationPipe({ transform: true }))
  async register(
    @Body() dto: RegisterPushTokenDto,
    @CurrentUser('id') userId: string
  ) {
    const result = await registerPushToken(db, { ...dto, userId });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
  }

  @Delete('push-token')
  @UsePipes(new ValidationPipe({ transform: true }))
  async unregister(@Body() dto: UnregisterPushTokenDto) {
    const result = await unregisterPushToken(db, dto);
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
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
