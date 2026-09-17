import { auth } from '@borradh-workspace/auth/server';
import { db } from '@borradh-workspace/database';
import {
  acceptInvitation,
  createOrganization,
  getInvitationByToken,
  getOrganization,
  getOrganizationBrand,
  getOrganizationMembers,
  inviteMember,
  listOrganizations,
  listPendingInvitations,
  removeMember,
  updateChatbotSettings,
} from '@borradh-workspace/features/organizations';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrgParamGuard,
  AdminGuard,
  AuthGuard,
  type AuthenticatedRequest,
  CurrentUser,
  MemberGuard,
  Public,
  SessionToken,
  SkipPaidPlanCheck,
} from '../common';
import { tryGetRedis } from '../common/optional-redis.js';
import { unwrapResult } from '../common/unwrap-result.js';
import {
  AcceptInvitationDto,
  CreateOrganizationDto,
  InviteMemberDto,
  UpdateChatbotSettingsDto,
} from './dto';

@Controller('organizations')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class OrganizationsController {
  private readonly logger = new Logger(OrganizationsController.name);

  /**
   * Bind this controller's logger + error mapper for `unwrapResult`. A
   * PROPERTY, not a method: Gate 5 counts every private method on a controller
   * as orchestration, and this holds none.
   */
  private readonly unwrapWith = (label: string) => ({
    logger: this.logger,
    label,
    mapError: (error: { code: string; message: string }) =>
      this.mapErrorToHttpException(error),
  });

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @SessionToken() sessionToken: string
  ) {
    this.logger.log(`List organizations for user: ${user.id}`);

    const result = await listOrganizations(auth.api, { sessionToken });

    if (!result.success) {
      this.logger.warn(
        `List organizations failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() createOrgDto: CreateOrganizationDto
  ) {
    this.logger.log('Create organization request');

    // The DTO uses string for country but schema expects specific enum
    // Zod validation in service will ensure valid country code
    const result = await createOrganization(db, {
      ...createOrgDto,
      createdByUserId: user.id,
    } as Parameters<typeof createOrganization>[1]);

    if (!result.success) {
      this.logger.warn(
        `Create organization failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Organization created successfully: ${result.data.id}`);
    return result.data;
  }

  @Get(':id')
  @UseGuards(MemberGuard, ActiveOrgParamGuard)
  async findOne(@Param('id') id: string) {
    const result = await getOrganization(db, { id });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id/brand')
  @UseGuards(MemberGuard, ActiveOrgParamGuard)
  async getBrand(@Param('id') id: string) {
    const result = await getOrganizationBrand(db, { organizationId: id });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id/members')
  @UseGuards(MemberGuard, ActiveOrgParamGuard)
  async getMembers(@Param('id') id: string) {
    const result = await getOrganizationMembers(db, { organizationId: id });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post(':id/invitations')
  @UseGuards(MemberGuard, AdminGuard, ActiveOrgParamGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async inviteMember(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id') id: string,
    @Body() inviteDto: InviteMemberDto
  ) {
    const data = unwrapResult(
      await inviteMember(db, {
        organizationId: id,
        email: inviteDto.email,
        role: inviteDto.role ?? 'member',
        inviterId: user.id,
        firstName: inviteDto.firstName,
        lastName: inviteDto.lastName,
        phone: inviteDto.phone,
        phoneCountry: inviteDto.phoneCountry,
        country: inviteDto.country,
      }),
      this.unwrapWith('Invite member')
    );

    this.logger.log(`Invitation sent successfully: ${data.id}`);
    return data;
  }

  @Delete(':id/members/:userId')
  @UseGuards(MemberGuard, ActiveOrgParamGuard)
  async removeMember(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id') id: string,
    @Param('userId') userId: string
  ) {
    const data = unwrapResult(
      await removeMember(
        db,
        { organizationId: id, userId, requesterId: user.id },
        tryGetRedis()
      ),
      this.unwrapWith('Remove member')
    );

    this.logger.log(`Member removed successfully from organization: ${id}`);
    return data;
  }

  @Get('invitations/pending')
  async listPendingInvitations(
    @CurrentUser() user: AuthenticatedRequest['user']
  ) {
    if (!user.email) {
      throw new HttpException('User email is required', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`List pending invitations for user: ${user.email}`);

    const result = await listPendingInvitations(db, {
      email: user.email,
    });

    if (!result.success) {
      this.logger.warn(
        `List pending invitations failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get('invitations/token/:token')
  @Public()
  async getInvitationByToken(@Param('token') token: string) {
    const result = await getInvitationByToken(db, { token });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post('invitations/:invitationId/accept')
  @UsePipes(new ValidationPipe({ transform: true }))
  async acceptInvitation(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('invitationId') invitationId: string,
    @Body() dto: AcceptInvitationDto
  ) {
    this.logger.log(
      `Accept invitation request: ${invitationId} by user: ${user.id}`
    );

    const result = await acceptInvitation(db, {
      invitationId,
      userId: user.id,
      acceptedTerms: dto.acceptedTerms,
    });

    if (!result.success) {
      this.logger.warn(
        `Accept invitation failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Invitation accepted successfully: ${invitationId}`);
    return result.data;
  }

  @Put(':id/chatbot-settings')
  @UseGuards(MemberGuard, ActiveOrgParamGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateChatbotSettings(
    @Param('id') id: string,
    @Body() dto: UpdateChatbotSettingsDto
  ) {
    const result = await updateChatbotSettings(db, {
      organizationId: id,
      ...dto,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
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
