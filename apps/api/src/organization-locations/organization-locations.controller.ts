import { db } from '@borradh-workspace/database';
import {
  applyLocationCatalog,
  createLocation,
  deleteLocation,
  getLocationCatalog,
  listLocations,
  setPrimaryLocation,
  updateLocation,
} from '@borradh-workspace/features/organization-locations';
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
  ActiveOrganization,
  AuthGuard,
  SkipPaidPlanCheck,
} from '../common/index.js';
import type {
  ApplyLocationCatalogDto,
  CreateLocationDto,
  ListLocationsDto,
  UpdateLocationDto,
} from './dto/index.js';

@Controller('organization-locations')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class OrganizationLocationsController {
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

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateLocationDto,
    @ActiveOrganization() activeOrganizationId: string | undefined
  ) {
    // The org comes from the session, full stop. This used to fall back to
    // `dto.organizationId`, which the canonical wire contract no longer carries
    // (and, being `.strict()`, now rejects): a body-supplied org id would let a
    // caller create a location inside an organization they are not acting as.
    const organizationId = this.requireActiveOrganization(activeOrganizationId);
    const result = await createLocation(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Set which practitioners / services / products / plans / promotions are
   * available AT this branch.
   *
   * ADDITIVE — it only adds. Zero join rows means "available at every branch",
   * so anything unrestricted is already available here and there is nothing to
   * add; and "available everywhere EXCEPT here" is deliberately not expressible.
   * See `locationCatalogSeedRequestSchema`.
   */
  /** The ids EXPLICITLY assigned here — what the edit screen ticks. */
  @Get(':id/catalog')
  async getCatalog(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getLocationCatalog(db, {
      locationId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id/catalog')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setCatalog(
    @Param('id') id: string,
    @Body() dto: ApplyLocationCatalogDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await applyLocationCatalog(db, {
      ...dto,
      locationId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @Query() dto: ListLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listLocations(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateLocation(db, { id, organizationId, ...dto });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteLocation(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
  }

  @Post(':id/set-primary')
  async setAsPrimary(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await setPrimaryLocation(db, { id, organizationId });
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
