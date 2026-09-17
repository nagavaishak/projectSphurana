import { db } from '@borradh-workspace/database';
import {
  createCampaign,
  deleteCampaign,
  diagnoseCampaign,
  getCampaignInsights,
  getCampaignLearningStatus,
  listCampaigns,
  listCampaignsInsights,
  pauseCampaign,
  queueDuplicateCampaign,
  resumeCampaign,
  updateCampaign,
} from '@borradh-workspace/features/meta-campaigns';
import { queueMetaSync } from '@borradh-workspace/features/meta-sync';
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
  type AuthenticatedRequest,
  CurrentUser,
  RequireRole,
  RoleGuard,
} from '../common';
import type {
  CreateCampaignDto,
  ListCampaignsDto,
  UpdateCampaignDto,
} from './dto';

@Controller('meta-campaigns')
@UseGuards(AuthGuard, RoleGuard)
export class MetaCampaignsController {
  private readonly logger = new Logger(MetaCampaignsController.name);

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

  private mapErrorToHttpException(error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }): HttpException {
    // A raw Meta rejection can be passed through under a generic code (e.g.
    // INTERNAL_ERROR) while still carrying the actionable WhatsApp text. As a
    // 500 the sanitize-errors filter strips the message, so the assistant's
    // createCampaign tool can't detect it and fall back to Messenger. Keep this
    // MESSAGE-based net; the code-based dispatch lives in the switch below —
    // one code, one status, and visible to the error-status gate.
    if (/whatsapp business account/i.test(error.message)) {
      return new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: error.message,
          code: error.code,
          ...(error.details && { details: error.details }),
        },
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }

    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.NOT_FOUND:
      case 'CAMPAIGN_NOT_FOUND':
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case 'META_NOT_CONFIGURED':
        return new HttpException(error.message, HttpStatus.PRECONDITION_FAILED);
      case 'META_LEAD_GEN_TOS_REQUIRED':
        return new HttpException(error.message, HttpStatus.PRECONDITION_FAILED);
      // The token no longer has access to the configured Page — fix it in Meta,
      // then retry. Same family as META_NOT_CONFIGURED.
      case 'META_PAGE_NOT_ACCESSIBLE':
        return new HttpException(error.message, HttpStatus.PRECONDITION_FAILED);
      // Meta cannot process the requested WhatsApp destination (see the
      // message-based net above — these keep the same 422).
      case 'META_WHATSAPP_DISCONNECTED':
      case 'META_WHATSAPP_PHONE_NOT_LINKED':
      case 'META_WHATSAPP_FREE_NUMBER_INELIGIBLE':
        return new HttpException(
          {
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            message: error.message,
            code: error.code,
            ...(error.details && { details: error.details }),
          },
          HttpStatus.UNPROCESSABLE_ENTITY
        );
      // Meta access token expired/revoked (ENG-311 / ENG-310). This is an
      // expected end-user condition — the customer revoked access, changed
      // their password, or removed the app. Surfacing it as a 500 paged it as
      // a server error and stripped the message; a 409 keeps the actionable
      // "reconnect Meta" message intact and lets the UI prompt a reconnect.
      case 'META_AUTH_EXPIRED':
        return new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message: error.message,
            code: error.code,
            ...(error.details && { details: error.details }),
          },
          HttpStatus.CONFLICT
        );
      // A restricted ad account is user-actionable, not a server fault — keep
      // the message + details and out of the 5xx noise (ENG-311 / ENG-310).
      case 'META_ACCOUNT_RESTRICTED':
        return new HttpException(
          {
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            message: error.message,
            code: error.code,
            ...(error.details && { details: error.details }),
          },
          HttpStatus.UNPROCESSABLE_ENTITY
        );
      case 'META_PAYMENT_METHOD_REQUIRED':
        return new HttpException(error.message, HttpStatus.PAYMENT_REQUIRED);
      case 'META_RATE_LIMITED':
        return new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      case ErrorCodes.FORBIDDEN:
        return new HttpException(error.message, HttpStatus.FORBIDDEN);
      // "Do something in Meta, then retry" — grouped with META_NOT_CONFIGURED /
      // META_LEAD_GEN_TOS_REQUIRED, and matching `meta-ads.controller.ts`.
      case 'META_USER_ACTION_REQUIRED':
        return new HttpException(error.message, HttpStatus.PRECONDITION_FAILED);
      case 'META_SYNC_FAILED':
        return new HttpException(
          {
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            message: error.message,
            code: error.code,
            ...(error.details && { details: error.details }),
          },
          HttpStatus.UNPROCESSABLE_ENTITY
        );
      default:
        return new HttpException(
          error.message,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ActiveOrganization() orgId: string | undefined,
    @Query() _query: ListCampaignsDto
  ) {
    this.logger.log('List campaigns request');
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await listCampaigns(db, {
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post()
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ActiveOrganization() orgId: string | undefined,
    @Body() createCampaignDto: CreateCampaignDto
  ) {
    this.logger.log('Create campaign request');
    const organizationId = this.requireActiveOrganization(orgId);

    // `startDate` / `endDate` arrive as ISO strings; `createCampaignSchema`
    // coerces them (see `optionalCampaignDate`).
    const result = await createCampaign(db, {
      ...createCampaignDto,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Campaign created on Meta: ${result.data.metaCampaignId}`);
    return result.data;
  }

  @Put(':metaCampaignId')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('metaCampaignId') metaCampaignId: string,
    @ActiveOrganization() orgId: string | undefined,
    @Body() dto: UpdateCampaignDto
  ) {
    this.logger.log(`Update campaign request for Meta ID: ${metaCampaignId}`);
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await updateCampaign(db, {
      metaCampaignId,
      organizationId,
      ...dto,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Campaign updated: ${metaCampaignId}`);
    return result.data;
  }

  /**
   * Duplication copies the campaign, every ad set and every ad one object at a
   * time (Meta's sync deep-copy caps at <3 objects), so it can take a while.
   * `queueDuplicateCampaign` enqueues it onto the worker fleet and returns
   * immediately rather than holding the request (and a DB connection) open for
   * the whole run.
   */
  @Post(':metaCampaignId/duplicate')
  @RequireRole('admin')
  async duplicate(
    @Param('metaCampaignId') metaCampaignId: string,
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log(
      `Duplicate campaign request for Meta ID: ${metaCampaignId}`
    );
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await queueDuplicateCampaign({
      organizationId,
      metaCampaignId,
      userId: user.id,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Queued duplication for campaign ${metaCampaignId}`);
    return { queued: true };
  }

  @Delete(':metaCampaignId')
  @RequireRole('admin')
  async remove(
    @Param('metaCampaignId') metaCampaignId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log(`Delete campaign request for Meta ID: ${metaCampaignId}`);
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await deleteCampaign(db, {
      metaCampaignId,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Campaign deleted: ${metaCampaignId}`);
    return { success: true };
  }

  @Post(':metaCampaignId/pause')
  @RequireRole('admin')
  async pause(
    @Param('metaCampaignId') metaCampaignId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log(`Pause campaign request for Meta ID: ${metaCampaignId}`);
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await pauseCampaign(db, {
      metaCampaignId,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Campaign paused: ${metaCampaignId}`);
    return result.data;
  }

  @Post(':metaCampaignId/resume')
  @RequireRole('admin')
  async resume(
    @Param('metaCampaignId') metaCampaignId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log(`Resume campaign request for Meta ID: ${metaCampaignId}`);
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await resumeCampaign(db, {
      metaCampaignId,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Campaign resumed: ${metaCampaignId}`);
    return result.data;
  }

  @Get('insights')
  async listInsights(
    @ActiveOrganization() orgId: string | undefined,
    @Query('since') since?: string,
    @Query('until') until?: string
  ) {
    this.logger.log('List campaign insights request (batched)');
    const organizationId = this.requireActiveOrganization(orgId);

    const dateRange = since && until ? { since, until } : undefined;

    const result = await listCampaignsInsights(db, {
      organizationId,
      dateRange,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':metaCampaignId/learning-status')
  async getLearningStatus(
    @Param('metaCampaignId') metaCampaignId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await getCampaignLearningStatus(db, {
      organizationId,
      metaCampaignId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':metaCampaignId/insights')
  async getInsights(
    @Param('metaCampaignId') metaCampaignId: string,
    @ActiveOrganization() orgId: string | undefined,
    @Query('since') since?: string,
    @Query('until') until?: string
  ) {
    this.logger.log(
      `Get campaign insights request for Meta ID: ${metaCampaignId}`
    );
    const organizationId = this.requireActiveOrganization(orgId);

    const dateRange = since && until ? { since, until } : undefined;

    const result = await getCampaignInsights(db, {
      metaCampaignId,
      organizationId,
      dateRange,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * Deterministic troubleshooting diagnosis for a campaign (PRD-1 Task 3).
   * Returns spend gate, high-intent lead stats, service tier, budget band, and
   * lifecycle round/escalation state. Keeps the LLM out of the arithmetic —
   * Claire's troubleshoot skill reads this verbatim. Read-only.
   */
  @Get(':metaCampaignId/diagnose')
  async diagnose(
    @Param('metaCampaignId') metaCampaignId: string,
    @ActiveOrganization() orgId: string | undefined,
    @Query('windowDays') windowDays?: string
  ) {
    this.logger.log(`Diagnose campaign request for Meta ID: ${metaCampaignId}`);
    const organizationId = this.requireActiveOrganization(orgId);

    // `windowDays` is a raw query-string value; `diagnoseCampaignSchema` parses
    // it and falls back to the default when it is absent or unparseable.
    const result = await diagnoseCampaign(db, {
      organizationId,
      metaCampaignId,
      windowDays,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post('sync-all')
  async syncAll(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log('Sync all Meta data request');
    const organizationId = this.requireActiveOrganization(orgId);

    // Enqueue the sync onto the worker fleet instead of running the ~11-12s
    // Meta Graph API sync inline. Holding a request (and the small API DB pool)
    // open for that long on every session is what saturates the pool and
    // starves interactive traffic. The worker runs it under the transaction-
    // free SYSTEM scope; per-org jobId collapses repeat triggers.
    const result = await queueMetaSync({
      organizationId,
      userId: user.id,
      force: false,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Queued Meta sync for org ${organizationId}`);
    return { queued: true };
  }
}
