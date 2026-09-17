import { db } from '@borradh-workspace/database';
import {
  createIntakeForm,
  deleteIntakeForm,
  getIntakeForm,
  getOutstandingIntake,
  getServiceIntakeForms,
  issueIntakeSubmission,
  listIntakeForms,
  listLeadSubmissions,
  seedIntakeTemplates,
  setServiceIntakeForms,
  updateIntakeForm,
} from '@borradh-workspace/features/intake-forms';
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
import { ActiveOrganization, AuthGuard, CurrentUser } from '../common/index.js';
import {
  CreateIntakeFormDto,
  IssueIntakeSubmissionDto,
  ListIntakeFormsDto,
  SeedIntakeTemplatesDto,
  SetServiceIntakeFormsDto,
  UpdateIntakeFormDto,
} from './dto/index.js';

/**
 * Authenticated dashboard routes for intake forms — the clinic's side.
 *
 * Thin controller: every handler resolves the active org from the session,
 * calls the matching feature service, and maps its Result to an HTTP status.
 * The public patient-facing fill-in surface lives in PublicIntakeController.
 */
@Controller('intake-forms')
@UseGuards(AuthGuard)
export class IntakeFormsController {
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
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateIntakeFormDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createIntakeForm(db, {
      ...dto,
      organizationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ActiveOrganization() orgId: string | undefined,
    @Query() dto: ListIntakeFormsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listIntakeForms(db, { ...dto, organizationId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  // ── Templates ───────────────────────────────────────────────────────────
  // Declared before `:id` so "seed-templates" isn't captured as a form id.
  @Post('seed-templates')
  @UsePipes(new ValidationPipe({ transform: true }))
  async seedTemplates(
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string,
    @Body() dto: SeedIntakeTemplatesDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await seedIntakeTemplates(db, {
      ...dto,
      organizationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  // ── Send a form to a patient ─────────────────────────────────────────────
  @Post('issue')
  @UsePipes(new ValidationPipe({ transform: true }))
  async issue(
    @ActiveOrganization() orgId: string | undefined,
    @Body() dto: IssueIntakeSubmissionDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await issueIntakeSubmission(db, { ...dto, organizationId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  // ── Service linking ──────────────────────────────────────────────────────
  @Get('services/:serviceId/forms')
  async getServiceForms(
    @ActiveOrganization() orgId: string | undefined,
    @Param('serviceId') serviceId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getServiceIntakeForms(db, {
      organizationId,
      serviceId,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Put('services/:serviceId/forms')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setServiceForms(
    @ActiveOrganization() orgId: string | undefined,
    @Param('serviceId') serviceId: string,
    @Body() dto: SetServiceIntakeFormsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await setServiceIntakeForms(db, {
      ...dto,
      organizationId,
      serviceId,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  // ── Client-profile submissions ───────────────────────────────────────────
  @Get('submissions/lead/:leadId')
  async listSubmissionsForLead(
    @ActiveOrganization() orgId: string | undefined,
    @Param('leadId') leadId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listLeadSubmissions(db, { organizationId, leadId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  // ── Booking gate ─────────────────────────────────────────────────────────
  @Get('outstanding/:appointmentId')
  async outstanding(
    @ActiveOrganization() orgId: string | undefined,
    @Param('appointmentId') appointmentId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getOutstandingIntake(db, {
      organizationId,
      appointmentId,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Get(':id')
  async findOne(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getIntakeForm(db, { organizationId, id });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateIntakeFormDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateIntakeForm(db, { ...dto, organizationId, id });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteIntakeForm(db, { organizationId, id });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
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
