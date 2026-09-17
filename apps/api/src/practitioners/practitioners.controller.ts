import { db } from '@borradh-workspace/database';
// The invitation itself is organizations' concern — the practitioner row only
// supplies WHO is being invited — so the service lives in that context.
import { invitePractitioner } from '@borradh-workspace/features/organizations';
import {
  addPractitionerLocations,
  assignPractitionerLocations,
  assignPractitionerServices,
  completePractitionerProfileSetup,
  createPractitioner,
  createTeamMember,
  deletePractitioner,
  getPractitioner,
  getPractitionerForUser,
  linkPractitionerToUser,
  listPractitioners,
  listPractitionersForService,
  updatePractitioner,
} from '@borradh-workspace/features/practitioners';
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
  RequireRole,
  RoleGuard,
  SkipPaidPlanCheck,
} from '../common/index.js';
import type {
  AddLocationsDto,
  AssignLocationsDto,
  AssignServicesDto,
  CreatePractitionerDto,
  CreateTeamMemberDto,
  InvitePractitionerDto,
  ListPractitionersDto,
  UpdatePractitionerDto,
} from './dto/index.js';

@Controller('practitioners')
@UseGuards(AuthGuard, RoleGuard)
@SkipPaidPlanCheck()
export class PractitionersController {
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
  @RequireRole('owner')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreatePractitionerDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    // The org comes from the session, full stop. This used to fall back to
    // `dto.organizationId`, which the canonical wire contract no longer carries
    // (and, being `.strict()`, now rejects): a body-supplied org id would let a
    // caller create a practitioner inside an organization they are not acting as.
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createPractitioner(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('team-member')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createTeamMember(
    @Body() dto: CreateTeamMemberDto,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') inviterId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createTeamMember(db, {
      ...dto,
      organizationId,
      inviterId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Send — or re-send — a team member's invitation email. Needed because a
   * practitioner created by the onboarding wizard never gets one (that path
   * writes the row and stops), and because an invitation that was sent but
   * lost previously had no way to be repeated.
   */
  @Post(':id/invite')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async invite(
    @Param('id') practitionerId: string,
    @Body() dto: InvitePractitionerDto,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') inviterId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await invitePractitioner(db, {
      ...dto,
      practitionerId,
      organizationId,
      inviterId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('me')
  async findForCurrentUser(
    @CurrentUser('id') userId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getPractitionerForUser(db, { userId, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('link-me')
  async linkCurrentUser(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await linkPractitionerToUser(db, {
      userId,
      organizationId,
      email,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/complete-profile-setup')
  async completeProfileSetup(
    @Param('id') practitionerId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await completePractitionerProfileSetup(db, {
      practitionerId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('for-service/:serviceId')
  async findForService(
    @Param('serviceId') serviceId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listPractitionersForService(db, {
      serviceId,
      organizationId,
      activeOnly: true,
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
    const result = await getPractitioner(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @Query() dto: ListPractitionersDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listPractitioners(db, {
      ...dto,
      organizationId,
      locationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePractitionerDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updatePractitioner(db, { id, organizationId, ...dto });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  @RequireRole('owner')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deletePractitioner(db, {
      id,
      organizationId,
      actorId: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
  }

  @Put(':id/services')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async assignServices(
    @Param('id') practitionerId: string,
    @Body() dto: AssignServicesDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await assignPractitionerServices(db, {
      practitionerId,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Also let this person work at these branches — the write behind adding
   * someone to a branch from the Team page.
   *
   * ADDITIVE, and the distinction matters more here than in the catalogue: the
   * PUT below replaces the whole set, so a caller sending a short list REMOVES
   * a branch, and a practitioner's branches decide where their appointments can
   * be booked. This endpoint cannot strand a booked-out week.
   */
  @Post(':id/locations')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addLocations(
    @Param('id') practitionerId: string,
    @Body() dto: AddLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await addPractitionerLocations(db, {
      practitionerId,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id/locations')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async assignLocations(
    @Param('id') practitionerId: string,
    @Body() dto: AssignLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await assignPractitionerLocations(db, {
      practitionerId,
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
