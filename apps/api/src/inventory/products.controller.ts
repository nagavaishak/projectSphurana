import { db } from '@borradh-workspace/database';
import {
  addProductLocations,
  adjustProductStock,
  assignProductLocations,
  createProduct,
  deleteProduct,
  getProduct,
  listProductStock,
  listProducts,
  removeProductLocation,
  updateProduct,
} from '@borradh-workspace/features/inventory';
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
import { ActiveLocation, ActiveOrganization, AuthGuard } from '../common';
import type {
  AddProductLocationsDto,
  AdjustStockDto,
  AssignProductLocationsDto,
  CreateProductDto,
  ListProductsDto,
  UpdateProductDto,
} from './dto';

@Controller('products')
@UseGuards(AuthGuard)
export class ProductsController {
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
    @Query() dto: ListProductsDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listProducts(db, {
      ...dto,
      organizationId,
      locationId,
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
    const result = await getProduct(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateProductDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createProduct(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateProduct(db, { ...dto, id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Also stock this product at these branches — the write behind "import from
   * another location".
   *
   * ADDITIVE, and deliberately not a flag on the PUT below: that endpoint
   * replaces the whole set, so adding one branch through it means resending
   * every existing entry, and an empty body there means "every branch" rather
   * than "none".
   */
  /**
   * Stop offering this product at ONE branch, leaving it in place everywhere
   * else — the "remove from this location" half of the delete prompt.
   *
   * Not a DELETE of the record: the record is shared across branches, so the
   * page-level delete would take it off all of them. Removing the LAST branch
   * is refused (409) rather than performed, because zero rows reads as "every
   * branch" — deactivating is how a business withdraws something outright.
   */
  @Delete(':id/locations/:locationId')
  async removeLocation(
    @Param('id') productId: string,
    @Param('locationId') locationId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await removeProductLocation(db, {
      productId,
      locationId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/locations')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addLocations(
    @Param('id') productId: string,
    @Body() dto: AddProductLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await addProductLocations(db, {
      ...dto,
      productId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Which branches stock this SKU. An empty `locationIds` array restores
   * "stocked at every branch" — see the contract. Per-branch QUANTITY lives in
   * `product_stock` and is set through `PUT :id/stock/:locationId`.
   */
  @Put(':id/locations')
  @UsePipes(new ValidationPipe({ transform: true }))
  async assignLocations(
    @Param('id') productId: string,
    @Body() dto: AssignProductLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await assignProductLocations(db, {
      ...dto,
      productId,
      organizationId,
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
    const result = await deleteProduct(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id/stock')
  async findStock(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listProductStock(db, {
      productId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id/stock/:locationId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async adjustStock(
    @Param('id') id: string,
    @Param('locationId') locationId: string,
    @Body() dto: AdjustStockDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await adjustProductStock(db, {
      productId: id,
      locationId,
      organizationId,
      quantity: dto.quantity,
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
