import { db } from '@borradh-workspace/database';
import {
  createCategory,
  deleteCategory,
  listCategories,
  reorderCategories,
  updateCategory,
} from '@borradh-workspace/features/service-categories';
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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  SkipPaidPlanCheck,
} from '../common/index.js';
import type {
  CreateCategoryDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
} from './dto/index.js';

@Controller('service-categories')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class ServiceCategoriesController {
  private requireActiveOrganization(orgId: string | undefined): string {
    if (!orgId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    return orgId;
  }

  @Get()
  async findAll(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listCategories(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateCategoryDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createCategory(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateCategory(db, { id, organizationId, ...dto });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteCategory(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
  }

  @Post('reorder')
  @UsePipes(new ValidationPipe({ transform: true }))
  async reorder(
    @Body() dto: ReorderCategoriesDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await reorderCategories(db, { ...dto, organizationId });
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
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
