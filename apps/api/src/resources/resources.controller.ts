import { db } from '@borradh-workspace/database';
import {
  createResource,
  createResourceCategory,
  deleteResource,
  deleteResourceCategory,
  getResourceUtilisation,
  getServiceResourceRequirements,
  listAppointmentResources,
  listResourceCategories,
  listResources,
  reorderResources,
  setServiceResourceRequirements,
  updateResource,
  updateResourceCategory,
} from '@borradh-workspace/features/resources';
import type { SetServiceResourceRequirementsResult } from '@borradh-workspace/features/resources';
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
} from '../common/index.js';
// VALUE import, deliberately NOT `import type`. nestjs-zod's global
// ZodValidationPipe reads the DTO class off `design:paramtypes`, which
// `emitDecoratorMetadata` only emits when the identifier survives to runtime. A
// type-only import erases it, TypeScript emits `Object`, and the pipe silently
// skips EVERY parameter on this controller — the `queryBoolean()` coercion in
// the DTOs becomes dead code and `?includeInactive=true` 400s because the raw
// string reaches a `z.boolean()`. It fails silently and only at runtime; a
// biome/lint auto-fix that "tidies" this back to `import type` reintroduces it.
// Locked by resource-requirements-api.int-spec.ts, which asserts paramtypes.
import {
  CreateResourceCategoryDto,
  CreateResourceDto,
  ListAppointmentResourcesDto,
  ListResourceCategoriesDto,
  ListResourcesDto,
  ReorderResourcesDto,
  ResourceUtilisationDto,
  SetServiceResourceRequirementsDto,
  UpdateResourceCategoryDto,
  UpdateResourceDto,
} from './dto/index.js';

/**
 * Rooms & equipment — the clinic's second availability source.
 *
 * ROUTE ORDER IS LOAD-BEARING. Nest matches in declaration order, so every
 * literal sub-path (`categories`, `reorder`, `requirements/:serviceId`,
 * `utilisation`, `allocations`) MUST be declared before the `:id` routes below
 * them. Move `@Put(':id')` above `@Put('reorder')` and `PUT /resources/reorder`
 * silently becomes "update the resource whose id is `reorder`" — a 404 at best.
 */
/**
 * `setServiceResourceRequirements`'s success payload.
 *
 * DERIVED, not re-declared: the features package exports the `Result` but not
 * the shape inside it, and TypeScript cannot name an un-exported external type
 * in a public method's inferred return type (TS4053). Pulling `data` back out
 * of the exported Result keeps the wire shape owned by exactly one file.
 */
export type SetServiceResourceRequirementsResponse = Extract<
  SetServiceResourceRequirementsResult,
  { success: true }
>['data'];

@Controller('resources')
@UseGuards(AuthGuard)
export class ResourcesController {
  private requireActiveOrganization(orgId: string | undefined): string {
    if (!orgId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    return orgId;
  }

  // ── Categories ────────────────────────────────────────────────────────────
  // Declared first: `categories` is a literal segment and would otherwise be
  // swallowed by `:id`.

  @Get('categories')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAllCategories(
    @Query() dto: ListResourceCategoriesDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listResourceCategories(db, {
      ...dto,
      organizationId,
      locationId: activeLocationId ?? dto.locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('categories')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createCategory(
    @Body() dto: CreateResourceCategoryDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createResourceCategory(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put('categories/:id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateResourceCategoryDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateResourceCategory(db, {
      ...dto,
      id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete('categories/:id')
  async removeCategory(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    // Shapes the refusal message only — the delete itself is org-wide, because
    // a category is. See the schema's `locationId`.
    const result = await deleteResourceCategory(db, {
      id,
      organizationId,
      locationId: activeLocationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
  }

  // ── Ordering, per-service rules and reports ───────────────────────────────
  // All literal sub-paths. Every one of these MUST stay above `:id`.

  @Put('reorder')
  @UsePipes(new ValidationPipe({ transform: true }))
  async reorder(
    @Body() dto: ReorderResourcesDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    // No `?? dto.locationId` fallback here, unlike the reads beside it: this is
    // a WRITE, and the DTO omits the field entirely so there is nothing to fall
    // back to. The branch comes from the validated header or not at all.
    const result = await reorderResources(db, {
      ...dto,
      organizationId,
      locationId: activeLocationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('requirements/:serviceId')
  async findRequirements(
    @Param('serviceId') serviceId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getServiceResourceRequirements(db, {
      serviceId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put('requirements/:serviceId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setRequirements(
    @Param('serviceId') serviceId: string,
    @Body() dto: SetServiceResourceRequirementsDto,
    @ActiveOrganization() orgId: string | undefined
  ): Promise<SetServiceResourceRequirementsResponse> {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await setServiceResourceRequirements(db, {
      ...dto,
      serviceId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('utilisation')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findUtilisation(
    @Query() dto: ResourceUtilisationDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getResourceUtilisation(db, {
      ...dto,
      organizationId,
      locationId: activeLocationId ?? dto.locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('allocations')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAllocations(
    @Query() dto: ListAppointmentResourcesDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listAppointmentResources(db, {
      ...dto,
      organizationId,
      locationId: activeLocationId ?? dto.locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  // ── Resources ─────────────────────────────────────────────────────────────

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @Query() dto: ListResourcesDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() activeLocationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listResources(db, {
      ...dto,
      organizationId,
      // The GUARD-validated header wins; the pre-existing `?locationId=`
      // filter is only a fallback for a client that has not adopted it. NOT
      // `dto.locationId ?? activeLocationId` — letting the request outrank the
      // header is the bug `sales.controller.spec.ts` exists to prevent.
      locationId: activeLocationId ?? dto.locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateResourceDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createResource(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  // ── `:id` LAST. Anything below this line is unreachable by a literal path. ─

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateResourceDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateResource(db, { ...dto, id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteResource(db, { id, organizationId });
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
