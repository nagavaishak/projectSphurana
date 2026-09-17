import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  createConsentFormTemplate,
  deleteConsentFormTemplate,
  generateConsentFormTemplate,
  getConsentPdfDownloadForStaff,
  listConsentFormSubmissions,
  listConsentFormTemplates,
  listServiceFormRequirements,
  setServiceFormRequirements,
  updateConsentFormTemplate,
} from '@borradh-workspace/features/consent-forms';
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
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  RequireRole,
  RoleGuard,
} from '../common';
import { CreateConsentFormTemplateDto } from './dto/create-consent-form-template.dto.js';
import { GenerateConsentFormTemplateDto } from './dto/generate-consent-form-template.dto.js';
import { ListConsentFormSubmissionsDto } from './dto/list-consent-form-submissions.dto.js';
import { ListConsentFormTemplatesDto } from './dto/list-consent-form-templates.dto.js';
import { SetServiceFormRequirementsDto } from './dto/set-service-form-requirements.dto.js';
import { UpdateConsentFormTemplateDto } from './dto/update-consent-form-template.dto.js';

/**
 * Staff-side consent-form management (ENG-647 Phases 2–3): templates, the
 * per-service requirement set, and submission status reads. Staff-only —
 * guarded by `AuthGuard`, NEVER `PatientAuthGuard`.
 *
 * EVERY handler carries an explicit `@RequireRole`. `RoleGuard` is a
 * PASSTHROUGH when a handler declares neither role nor permission metadata
 * (role.guard.ts), so listing it in `@UseGuards` without a per-handler
 * decorator authenticates but does not authorize — the route reads as guarded
 * while being open to any org member. Do not add a handler here without one.
 *
 * Where the line sits, against the three-tier model in guards/permissions.ts:
 *   member — trusted staff, i.e. practitioners. They read templates, see who
 *            has signed, and open a signed PDF: that is day-to-day clinical
 *            work and gating it higher would push clinics onto shared logins.
 *   admin  — authoring and configuration: creating, editing and deleting
 *            templates, choosing which services require them, and spending
 *            model credits via "Write with AI". Consistent with
 *            `services:manage` sitting at admin.
 */
@Controller('consent-form-templates')
@UseGuards(AuthGuard, RoleGuard)
export class ConsentFormTemplatesController {
  private readonly logger = new Logger(ConsentFormTemplatesController.name);

  // ── Service form requirements ─────────────────────────────────────────────
  // Declared before the `:id` routes so the static segment wins the match.

  @Get('organization-services-form-requirements/:serviceId')
  @RequireRole('member')
  async getServiceFormRequirements(
    @ActiveOrganization() organizationId: string,
    @Param('serviceId') serviceId: string
  ) {
    const result = await listServiceFormRequirements(db, {
      organizationId,
      serviceId,
    });

    if (!result.success) {
      this.logger.warn(
        `List service form requirements failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Put('organization-services-form-requirements/:serviceId')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async putServiceFormRequirements(
    @ActiveOrganization() organizationId: string,
    @Param('serviceId') serviceId: string,
    @Body() dto: SetServiceFormRequirementsDto
  ) {
    const result = await setServiceFormRequirements(db, {
      organizationId,
      serviceId,
      templateIds: dto.templateIds,
    });

    if (!result.success) {
      this.logger.warn(
        `Set service form requirements failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  // ── Submission status (staff view) ────────────────────────────────────────

  @Get('submissions')
  @RequireRole('member')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findSubmissions(
    @ActiveOrganization() organizationId: string,
    @Query() dto: ListConsentFormSubmissionsDto
  ) {
    const result = await listConsentFormSubmissions(db, {
      ...dto,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `List consent form submissions failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /** Presigned download of a signed submission's PDF (generated on demand). */
  @Get('submissions/:id/pdf')
  @RequireRole('member')
  async downloadSubmissionPdf(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await getConsentPdfDownloadForStaff(db, {
      submissionId: id,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Consent PDF download failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  // ── Templates CRUD ────────────────────────────────────────────────────────

  @Get()
  @RequireRole('member')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ActiveOrganization() organizationId: string,
    @Query() dto: ListConsentFormTemplatesDto
  ) {
    const result = await listConsentFormTemplates(db, {
      ...dto,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `List consent form templates failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * "Write with AI" — drafts a full template (title, body, fields, signature
   * flag) from a short description. Static `generate` segment is declared
   * before the `:id` routes; nothing is persisted, the clinician reviews and
   * saves via the normal create flow.
   */
  @Post('generate')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async generate(
    @ActiveOrganization() organizationId: string,
    @Body() dto: GenerateConsentFormTemplateDto
  ) {
    // A missing key is handled inside the use case (EXTERNAL_SERVICE_ERROR),
    // so the handler stays a thin "call the use case, map, return".
    const result = await generateConsentFormTemplate(
      db,
      { ...dto, organizationId },
      apiEnv.OPENAI_API_KEY
    );

    if (!result.success) {
      this.logger.warn(
        `Generate consent form template failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post()
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ActiveOrganization() organizationId: string,
    @Body() dto: CreateConsentFormTemplateDto
  ) {
    const result = await createConsentFormTemplate(db, {
      ...dto,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Create consent form template failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Consent form template created: ${result.data.id}`);
    return result.data;
  }

  @Put(':id')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConsentFormTemplateDto
  ) {
    const result = await updateConsentFormTemplate(db, {
      id,
      organizationId,
      ...dto,
    });

    if (!result.success) {
      this.logger.warn(
        `Update consent form template failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Delete(':id')
  @RequireRole('admin')
  async remove(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await deleteConsentFormTemplate(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Delete consent form template failed: ${result.error.code} - ${result.error.message}`
      );
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
      // AI provider busy/over quota or unreachable — let the client retry
      // rather than reporting a generic 500.
      case ErrorCodes.RATE_LIMITED:
        return new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      case ErrorCodes.EXTERNAL_SERVICE_ERROR:
        return new HttpException(error.message, HttpStatus.BAD_GATEWAY);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
