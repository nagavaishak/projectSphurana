import { db } from '@borradh-workspace/database';
import {
  type BlockedTimeEditScope,
  createBlockedTime,
  deleteBlockedTime,
  listBlockedTime,
  updateBlockedTime,
} from '@borradh-workspace/features/scheduling';
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
} from '../common/index.js';
import { BlockedTimeScopePipe } from './blocked-time-scope.pipe.js';
import type {
  CreateBlockedTimeDto,
  ListBlockedTimeDto,
  UpdateBlockedTimeDto,
} from './dto/index.js';

@Controller('blocked-time')
@UseGuards(AuthGuard)
export class BlockedTimeController {
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
    @Query() dto: ListBlockedTimeDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listBlockedTime(db, {
      ...dto,
      organizationId,
      locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateBlockedTimeDto,
    @CurrentUser('id') userId: string,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createBlockedTime(db, {
      ...dto,
      organizationId,
      // A block created while working in a branch belongs to that branch. With
      // no branch selected it stays NULL, i.e. org-wide — which is what every
      // existing block is.
      locationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBlockedTimeDto,
    @Query('scope', BlockedTimeScopePipe) scope: BlockedTimeEditScope,
    @CurrentUser('id') userId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateBlockedTime(db, {
      ...dto,
      id,
      organizationId,
      scope,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Query('scope', BlockedTimeScopePipe) scope: BlockedTimeEditScope,
    @Query('originalStart') originalStart: string | undefined,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteBlockedTime(db, {
      id,
      organizationId,
      scope,
      originalStart: originalStart ? new Date(originalStart) : undefined,
    });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
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
