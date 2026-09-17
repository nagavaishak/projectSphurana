import { db } from '@borradh-workspace/database';
import type { SessionSecondaryStorageRedis } from '@borradh-workspace/features/auth';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  deleteUser,
  getUser,
  updateUserProfile,
} from '@borradh-workspace/features/users';
import { getRedis } from '@borradh-workspace/redis';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard, CurrentUser, SkipPaidPlanCheck } from '../common';
import { UpdateUserDto } from './dto/index.js';

/**
 * Redis is optional infrastructure here — it is absent in local/test runs, and
 * both the profile save and the account delete degrade gracefully without it.
 * Module-level (not a controller member) because wiring an optional client is
 * transport plumbing, not request orchestration.
 */
function optionalRedis(): SessionSecondaryStorageRedis | null {
  try {
    return getRedis() as unknown as SessionSecondaryStorageRedis;
  } catch {
    /* Redis not configured */
    return null;
  }
}

@Controller('users')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') currentUserId: string
  ) {
    if (id !== currentUserId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const result = await getUser(db, { id });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser('id') currentUserId: string
  ) {
    if (id !== currentUserId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const result = await updateUserProfile(
      db,
      { id, ...updateUserDto },
      optionalRedis()
    );

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Delete('me')
  async deleteMe(@CurrentUser('id') userId: string) {
    this.logger.log(`Delete user request for current user: ${userId}`);

    const result = await deleteUser(db, { id: userId }, optionalRedis());

    if (!result.success) {
      this.logger.warn(
        `Delete user failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`User deleted successfully: ${userId}`);
    return { success: true };
  }

  private mapErrorToHttpException(error: { code: string; message: string }) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_INPUT:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case ErrorCodes.FORBIDDEN:
        return new HttpException(error.message, HttpStatus.FORBIDDEN);
      case ErrorCodes.NOT_FOUND:
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      case ErrorCodes.ALREADY_EXISTS:
      case ErrorCodes.CONFLICT:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
