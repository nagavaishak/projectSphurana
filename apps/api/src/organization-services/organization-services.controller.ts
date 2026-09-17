import {
  importServicesCsvResponseSchema,
  listServicesResponseSchema,
  organizationServiceSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import { triggerServicesChanged } from '@borradh-workspace/features/claire';
import {
  addServiceLocations,
  assignServiceLocations,
  createService,
  createServiceVariant,
  deleteService,
  deleteServiceVariant,
  getService,
  importServicesCsv,
  listServiceVariants,
  listServices,
  removeServiceLocation,
  reorderServiceVariants,
  seedDefaultServices,
  updateService,
  updateServiceVariant,
} from '@borradh-workspace/features/organization-services';
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
import { Throttle } from '@nestjs/throttler';
import {
  ActiveLocation,
  ActiveOrganization,
  AuthGuard,
  RequireRole,
  ResponseContract,
  RoleGuard,
  SkipPaidPlanCheck,
} from '../common/index.js';
import type {
  AddServiceLocationsDto,
  AssignServiceLocationsDto,
  CreateServiceDto,
  CreateServiceVariantDto,
  ImportServicesCsvDto,
  ListServicesDto,
  ReorderServiceVariantsDto,
  UpdateServiceDto,
  UpdateServiceVariantDto,
} from './dto/index.js';

@Controller('organization-services')
@UseGuards(AuthGuard, RoleGuard)
@SkipPaidPlanCheck()
export class OrganizationServicesController {
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
    @Body() dto: CreateServiceDto,
    @ActiveOrganization() activeOrganizationId: string | undefined
  ) {
    // `organizationId` is server-injected only. It used to fall back to
    // `dto.organizationId`, which required the DTO to accept an org id in the
    // BODY — a field the canonical wire contract does not have and `.strict()`
    // now rejects. No client ever sent it.
    const organizationId = this.requireActiveOrganization(activeOrganizationId);
    const result = await createService(db, {
      ...dto,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);

    // Debounced reclassify of the org's business profile (Claire engine).
    void triggerServicesChanged(organizationId);

    return result.data;
  }

  /**
   * Bulk-create the catalogue from a spreadsheet the clinic exported out of
   * its previous booking system. Admin-only and heavily throttled: one call
   * can make an AI column-mapping request and write hundreds of services.
   */
  @ResponseContract(importServicesCsvResponseSchema)
  @Post('import-csv')
  @RequireRole('admin')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @UsePipes(new ValidationPipe({ transform: true }))
  async importFromCsv(
    @Body() dto: ImportServicesCsvDto,
    @ActiveOrganization() activeOrganizationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(activeOrganizationId);
    const result = await importServicesCsv(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);

    // Same Claire re-profile the single-service create triggers — an import is
    // the largest catalogue change an org will ever make.
    void triggerServicesChanged(organizationId);

    return result.data;
  }

  @ResponseContract(listServicesResponseSchema)
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @Query() dto: ListServicesDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listServices(db, {
      ...dto,
      organizationId,
      locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  // ── Service variants (optional per-service pricing options) ───────────────
  // Routes are declared before the generic `:id` routes; the extra path
  // segments keep them unambiguous either way.

  @Get(':serviceId/variants')
  async listVariants(
    @Param('serviceId') serviceId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listServiceVariants(db, {
      organizationId,
      serviceId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':serviceId/variants')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createVariant(
    @Param('serviceId') serviceId: string,
    @Body() dto: CreateServiceVariantDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createServiceVariant(db, {
      ...dto,
      organizationId,
      serviceId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':serviceId/variants/reorder')
  @UsePipes(new ValidationPipe({ transform: true }))
  async reorderVariants(
    @Param('serviceId') serviceId: string,
    @Body() dto: ReorderServiceVariantsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await reorderServiceVariants(db, {
      ...dto,
      organizationId,
      serviceId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put('variants/:variantId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateVariant(
    @Param('variantId') variantId: string,
    @Body() dto: UpdateServiceVariantDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateServiceVariant(db, {
      ...dto,
      id: variantId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete('variants/:variantId')
  async removeVariant(
    @Param('variantId') variantId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteServiceVariant(db, {
      id: variantId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
  }

  @ResponseContract(organizationServiceSchema)
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getService(db, {
      id,
      organizationId,
      locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateService(db, {
      id,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);

    void triggerServicesChanged(organizationId);

    return result.data;
  }

  /**
   * Also offer this service at these branches — the write behind "import from
   * another location".
   *
   * ADDITIVE, and deliberately not a flag on the PUT below: the PUT replaces
   * the whole set, so adding one branch through it means resending every
   * existing entry with its `priceCentsOverride` — a value no read path
   * exposes, which is how a caller silently blanks a branch's price.
   */
  /**
   * Stop offering this service at ONE branch, leaving it in place everywhere
   * else — the "remove from this location" half of the delete prompt.
   *
   * Not a DELETE of the record: the record is shared across branches, so the
   * page-level delete would take it off all of them. Removing the LAST branch
   * is refused (409) rather than performed, because zero rows reads as "every
   * branch" — deactivating is how a business withdraws something outright.
   */
  @Delete(':id/locations/:locationId')
  @RequireRole('admin')
  async removeLocation(
    @Param('id') serviceId: string,
    @Param('locationId') locationId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await removeServiceLocation(db, {
      serviceId,
      locationId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/locations')
  // Same role gate as the PUT: assignment carries per-branch pricing, so it is
  // a commercial decision rather than day-to-day catalogue upkeep.
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addLocations(
    @Param('id') serviceId: string,
    @Body() dto: AddServiceLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await addServiceLocations(db, {
      serviceId,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);

    // The catalogue a branch offers just changed — the same invalidation the
    // create/update paths fire.
    void triggerServicesChanged(organizationId);

    return result.data;
  }

  /**
   * Which branches offer this service, and at what price. An empty `locations`
   * array restores "offered at every branch" — see the contract.
   */
  @Put(':id/locations')
  // Admin, matching `PUT /practitioners/:id/locations`. Branch assignment
  // carries per-branch PRICING, so it is a commercial decision rather than
  // day-to-day catalogue upkeep.
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async assignLocations(
    @Param('id') serviceId: string,
    @Body() dto: AssignServiceLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await assignServiceLocations(db, {
      serviceId,
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

    const result = await deleteService(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);

    void triggerServicesChanged(organizationId);

    return { success: true };
  }

  @Post('seed')
  @UsePipes(new ValidationPipe({ transform: true }))
  async seed(
    @ActiveOrganization() orgId: string | undefined,
    @Body() body: {
      businessType:
        | 'hairdresser'
        | 'barber'
        | 'salon'
        | 'spa'
        | 'nail_salon'
        | 'tattoo_studio'
        | 'other';
    }
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await seedDefaultServices(db, {
      organizationId,
      businessType: body.businessType,
    });
    if (!result.success) throw this.mapError(result.error);

    void triggerServicesChanged(organizationId);

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
