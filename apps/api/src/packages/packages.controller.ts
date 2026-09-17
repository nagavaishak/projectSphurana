import { db } from '@borradh-workspace/database';
import {
  addPackageItem,
  createPackage,
  deletePackage,
  getPackage,
  listPackages,
  removePackageItem,
  reorderPackageItems,
  updatePackage,
  updatePackageItem,
} from '@borradh-workspace/features/packages';
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
  AddPackageItemDto,
  CreatePackageDto,
  ReorderPackageItemsDto,
  UpdatePackageDto,
  UpdatePackageItemDto,
} from './dto/index.js';

@Controller('packages')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class PackagesController {
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
    const result = await listPackages(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getPackage(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreatePackageDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createPackage(db, {
      ...dto,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePackageDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updatePackage(db, {
      id,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await deletePackage(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
  }

  @Post(':id/items')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addItem(
    @Param('id') packageId: string,
    @Body() dto: AddPackageItemDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await addPackageItem(db, {
      packageId,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id/items/:itemId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateItem(
    @Param('id') packageId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePackageItemDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updatePackageItem(db, {
      packageId,
      itemId,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id/items/:itemId')
  async removeItem(
    @Param('id') packageId: string,
    @Param('itemId') itemId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await removePackageItem(db, {
      packageId,
      itemId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
  }

  @Post(':id/items/reorder')
  @UsePipes(new ValidationPipe({ transform: true }))
  async reorderItems(
    @Param('id') packageId: string,
    @Body() dto: ReorderPackageItemsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await reorderPackageItems(db, {
      packageId,
      organizationId,
      ...dto,
    });
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
