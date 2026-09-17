import { db } from '@borradh-workspace/database';
import {
  addMembershipPlanLocations,
  assignMembershipPlanLocations,
  createMembershipPlan,
  deleteMembershipPlan,
  getMembershipPlan,
  listMembershipPlans,
  removeMembershipPlanLocation,
  updateMembershipPlan,
} from '@borradh-workspace/features/memberships';
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
import { ActiveLocation, ActiveOrganization, AuthGuard } from '../common';
import type {
  AddMembershipPlanLocationsDto,
  AssignMembershipPlanLocationsDto,
  CreateMembershipPlanDto,
  UpdateMembershipPlanDto,
} from './dto';

@Controller('membership-plans')
@UseGuards(AuthGuard)
export class MembershipPlansController {
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
  async findAll(
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listMembershipPlans(db, {
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
    const result = await getMembershipPlan(db, {
      planId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateMembershipPlanDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createMembershipPlan(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMembershipPlanDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateMembershipPlan(db, {
      ...dto,
      planId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Also sell this plan at these branches — the write behind "import from
   * another location".
   *
   * ADDITIVE, and deliberately not a flag on the PUT below: that endpoint
   * replaces the whole set, so adding one branch through it means resending
   * every existing entry, and an empty body there means "every branch" rather
   * than "none".
   */
  /**
   * Stop offering this plan at ONE branch, leaving it in place everywhere
   * else — the "remove from this location" half of the delete prompt.
   *
   * Not a DELETE of the record: the record is shared across branches, so the
   * page-level delete would take it off all of them. Removing the LAST branch
   * is refused (409) rather than performed, because zero rows reads as "every
   * branch" — deactivating is how a business withdraws something outright.
   */
  @Delete(':id/locations/:locationId')
  async removeLocation(
    @Param('id') planId: string,
    @Param('locationId') locationId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await removeMembershipPlanLocation(db, {
      planId,
      locationId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/locations')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addLocations(
    @Param('id') planId: string,
    @Body() dto: AddMembershipPlanLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await addMembershipPlanLocations(db, {
      ...dto,
      planId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Which branches sell this plan. An empty `locationIds` array restores "sold
   * at every branch" — see the contract.
   */
  @Put(':id/locations')
  @UsePipes(new ValidationPipe({ transform: true }))
  async assignLocations(
    @Param('id') planId: string,
    @Body() dto: AssignMembershipPlanLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await assignMembershipPlanLocations(db, {
      ...dto,
      planId,
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
    const result = await deleteMembershipPlan(db, {
      planId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return { success: true, ...result.data };
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
      [ErrorCodes.EXTERNAL_SERVICE_ERROR]: HttpStatus.BAD_GATEWAY,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
