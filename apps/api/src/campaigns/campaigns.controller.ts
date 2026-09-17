import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  type EnqueueCampaignJob,
  cancelCampaign,
  checkChannelEntitlement,
  createCampaign,
  createSegment,
  deleteCampaign,
  deleteSegment,
  draftCampaignContent,
  enqueueCampaignSend,
  ensureCampaignWhatsappTemplate,
  getCampaign,
  getCampaignAnalytics,
  getSegment,
  getSmsNumber,
  launchCampaign,
  listCampaignRecipients,
  listCampaigns,
  listSampleRecipients,
  listSegments,
  listSuppressions,
  previewSegment,
  provisionSmsNumber,
  resumeCampaign,
  searchSmsNumbers,
  streamCampaignDraft,
  syncWhatsappTemplates,
  updateCampaign,
  updateSegment,
  upsertCampaignMessage,
} from '@borradh-workspace/features/campaigns';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { TwilioSMSService } from '@borradh-workspace/integrations/sms';
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
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  RoleGuard,
} from '../common';
import {
  CreateCampaignDto,
  CreateSegmentDto,
  DraftCampaignContentDto,
  ListCampaignsDto,
  ListSegmentsDto,
  ListSuppressionsDto,
  PreviewSegmentDto,
  ProvisionSmsNumberDto,
  SampleRecipientsDto,
  SearchSmsNumbersDto,
  UpdateCampaignDto,
  UpdateSegmentDto,
  UpsertCampaignMessageDto,
} from './dto/index.js';

@Controller('campaigns')
@UseGuards(AuthGuard, RoleGuard)
export class CampaignsController {
  private readonly logger = new Logger(CampaignsController.name);

  // Enqueue adapter: bridges the BullMQ queue to the launch/resume services.
  private readonly enqueue: EnqueueCampaignJob = async ({
    recipientId,
    organizationId,
    campaignId,
  }) => {
    const r = await enqueueCampaignSend({
      recipientId,
      organizationId,
      campaignId,
      delayMs: 0,
    });
    if (!r.success) throw new Error(r.error.message);
  };

  // ===========================================================================
  // Segments (declared before `:id` so static paths aren't captured)
  // ===========================================================================

  @Post('segments')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createSegmentRoute(
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSegmentDto
  ) {
    const result = await createSegment(db, {
      ...dto,
      organizationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('segments')
  @UsePipes(new ValidationPipe({ transform: true }))
  async listSegmentsRoute(
    @ActiveOrganization() organizationId: string,
    @Query() dto: ListSegmentsDto
  ) {
    const result = await listSegments(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('segments/preview')
  @UsePipes(new ValidationPipe({ transform: true }))
  async previewSegmentRoute(
    @ActiveOrganization() organizationId: string,
    @Body() dto: PreviewSegmentDto
  ) {
    const result = await previewSegment(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Sample recipients for the composer's mail-merge preview — the first N
   * eligible leads for a segment + channel, with their merge fields.
   */
  @Post('segments/sample-recipients')
  @UsePipes(new ValidationPipe({ transform: true }))
  async sampleRecipientsRoute(
    @ActiveOrganization() organizationId: string,
    @Body() dto: SampleRecipientsDto
  ) {
    const result = await listSampleRecipients(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('segments/:id')
  async getSegmentRoute(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await getSegment(db, { organizationId, id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put('segments/:id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateSegmentRoute(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSegmentDto
  ) {
    const result = await updateSegment(db, { ...dto, organizationId, id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete('segments/:id')
  async deleteSegmentRoute(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await deleteSegment(db, { organizationId, id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  // ===========================================================================
  // Suppressions
  // ===========================================================================

  @Get('suppressions')
  @UsePipes(new ValidationPipe({ transform: true }))
  async listSuppressionsRoute(
    @ActiveOrganization() organizationId: string,
    @Query() dto: ListSuppressionsDto
  ) {
    const result = await listSuppressions(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  // ===========================================================================
  // Campaigns
  // ===========================================================================

  @Post('draft-content')
  @UsePipes(new ValidationPipe({ transform: true }))
  async draftContent(
    @ActiveOrganization() organizationId: string,
    @Body() dto: DraftCampaignContentDto
  ) {
    const result = await draftCampaignContent(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** SSE: stream OpenAI-generated copy token-by-token for live drafting. */
  @Post('draft-content/stream')
  async draftContentStream(
    @Body() body: { channel: 'email' | 'sms' | 'whatsapp'; prompt: string },
    @Res() res: Response
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    try {
      for await (const token of streamCampaignDraft({
        channel: body.channel,
        prompt: body.prompt ?? '',
      })) {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    } catch (err) {
      this.logger.warn(
        `draft stream failed: ${err instanceof Error ? err.message : 'error'}`
      );
      res.write(`data: ${JSON.stringify({ error: 'draft_failed' })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCampaignDto
  ) {
    const result = await createCampaign(db, {
      ...dto,
      organizationId,
      createdById: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ActiveOrganization() organizationId: string,
    @Query() dto: ListCampaignsDto
  ) {
    const result = await listCampaigns(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('entitlements')
  async entitlements(@ActiveOrganization() organizationId: string) {
    const result = await checkChannelEntitlement(db, {
      organizationId,
      channels: ['email', 'sms', 'whatsapp'],
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  // ── SMS number provisioning (Twilio) ────────────────────────────────────
  // Static `sms-number*` routes are declared before `:id` so they aren't
  // swallowed by the `:id` param route.

  @Get('sms-number')
  async smsNumber(@ActiveOrganization() organizationId: string) {
    const result = await getSmsNumber(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('sms-number/available')
  @UsePipes(new ValidationPipe({ transform: true }))
  async smsNumbersAvailable(
    @ActiveOrganization() organizationId: string,
    @Query() dto: SearchSmsNumbersDto
  ) {
    const result = await searchSmsNumbers(
      { organizationId, ...dto },
      new TwilioSMSService()
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('sms-number')
  @UsePipes(new ValidationPipe({ transform: true }))
  async provisionSms(
    @ActiveOrganization() organizationId: string,
    @Body() dto: ProvisionSmsNumberDto
  ) {
    const result = await provisionSmsNumber(
      db,
      {
        organizationId,
        ...dto,
        smsWebhookUrl: apiEnv.CAMPAIGNS_SMS_WEBHOOK_URL,
      },
      new TwilioSMSService()
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  // ── WhatsApp templates (linked WABA) ────────────────────────────────────
  // Static route declared before `:id` so it isn't swallowed by the param
  // route. Reads the org's template cache; `?refresh=true` re-syncs from Meta
  // via the linked WhatsApp Business account.

  @Get('whatsapp-templates')
  async whatsappTemplates(
    @ActiveOrganization() organizationId: string,
    @Query('refresh') refresh?: string
  ) {
    const result = await syncWhatsappTemplates(db, {
      organizationId,
      refresh: refresh === 'true',
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Auto-provision the canonical `borradh_campaign_message` template for the
   * org's active WABA (idempotent). Returns its status so the composer can show
   * the first-run "up to 24h for Meta approval" notice when it was just created.
   */
  @Post('whatsapp-templates/ensure')
  async ensureWhatsappTemplate(@ActiveOrganization() organizationId: string) {
    const result = await ensureCampaignWhatsappTemplate(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id')
  async findOne(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await getCampaign(db, { organizationId, id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id/analytics')
  async analytics(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await getCampaignAnalytics(db, { organizationId, id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get(':id/recipients')
  async recipients(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await listCampaignRecipients(db, { organizationId, id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto
  ) {
    const result = await updateCampaign(db, { ...dto, organizationId, id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await deleteCampaign(db, { organizationId, id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/messages')
  @UsePipes(new ValidationPipe({ transform: true }))
  async upsertMessage(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpsertCampaignMessageDto
  ) {
    const result = await upsertCampaignMessage(db, {
      ...dto,
      organizationId,
      campaignId: id,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/launch')
  async launch(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    this.logger.log(`Launch campaign ${id} for org ${organizationId}`);
    const result = await launchCampaign(
      db,
      { organizationId, id },
      this.enqueue
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/resume')
  async resume(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await resumeCampaign(
      db,
      { organizationId, id },
      this.enqueue
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/cancel')
  async cancel(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    const result = await cancelCampaign(db, { organizationId, id });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_INPUT:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case ErrorCodes.FORBIDDEN:
        return new HttpException(error.message, HttpStatus.FORBIDDEN);
      // Meta token expiry is a linked-integration state, not a Borradh
      // authentication failure. Keep it a 409 so the client can prompt for a
      // reconnect without logging the user out or producing a 500/Sentry event.
      case 'META_AUTH_EXPIRED':
        return new HttpException(error.message, HttpStatus.CONFLICT);
      case 'META_USER_ACTION_REQUIRED':
        return new HttpException(error.message, HttpStatus.PRECONDITION_FAILED);
      case 'META_PAYMENT_METHOD_REQUIRED':
        return new HttpException(error.message, HttpStatus.PAYMENT_REQUIRED);
      case 'META_RATE_LIMITED':
        return new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      case 'META_ACCOUNT_RESTRICTED':
        return new HttpException(
          error.message,
          HttpStatus.UNPROCESSABLE_ENTITY
        );
      // Out of credits is a billing condition, not a permission failure.
      // 402 is the status `billing.controller.ts` already returns for this code.
      case 'INSUFFICIENT_CREDITS':
        return new HttpException(error.message, HttpStatus.PAYMENT_REQUIRED);
      case ErrorCodes.NOT_FOUND:
      case 'CAMPAIGN_NOT_FOUND':
      case 'SEGMENT_NOT_FOUND':
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      case ErrorCodes.ALREADY_EXISTS:
      case ErrorCodes.CONFLICT:
      case 'CAMPAIGN_NOT_EDITABLE':
        return new HttpException(error.message, HttpStatus.CONFLICT);
      case 'CHANNEL_NOT_CONFIGURED':
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
