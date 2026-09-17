import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { promoteDraftAd } from '@borradh-workspace/features/claire';
import {
  acknowledgeMetaAdsWebhook,
  createAd,
  deleteAd,
  duplicateAd,
  getAd,
  healthCheck,
  importMetaAds,
  launchAdFromPost,
  launchAndFinalizeAd,
  listAds,
  publishAd,
  replaceAdCreative,
  syncAdStatus,
  updateAd,
} from '@borradh-workspace/features/meta-ads';
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
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ActiveOrganization,
  AuthGuard,
  Public,
  RequireRole,
  RoleGuard,
} from '../common';
import { MediaUrls } from '../common/decorators/media-urls.decorator.js';
import {
  HubChallenge,
  HubChallengeEcho,
} from '../common/guards/webhooks/hub-challenge.guard.js';
import { MediaUrlInterceptor } from '../common/interceptors/media-url.interceptor.js';
import {
  CreateAdDto,
  LaunchAdDto,
  LaunchAdFromPostDto,
  ListAdsDto,
  ReplaceAdCreativeDto,
  UpdateAdDto,
} from './dto/index.js';

/**
 * Creative URLs are resolved by `MediaUrlInterceptor` from the `@MediaUrls` spec
 * on each read route — see
 * `apps/api/src/common/interceptors/media-url.interceptor.ts`.
 *
 * NOTE the deliberate asymmetry, pinned by the characterization suite: the
 * SINGLE-ad shape names the video field `blobUrl`, the LIST shape names the same
 * underlying column `videoUrl`. Do not "tidy" one of them without a conscious
 * decision — the frontend reads both names.
 */
const GRAPHIC_IMAGE_URL = {
  path: 'graphicImageUrl',
  strategy: 'graphic',
  keyField: 'graphicImageKey',
} as const;
const VIDEO_THUMBNAIL_URL = {
  path: 'video.thumbnailUrl',
  strategy: 'media',
} as const;

@Controller('meta-ads')
@UseGuards(AuthGuard, RoleGuard)
@UseInterceptors(MediaUrlInterceptor)
export class MetaAdsController {
  private readonly logger = new Logger(MetaAdsController.name);

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
    const statusMap: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      // INVALID_STATE is a user-actionable state conflict ("already promoted",
      // "missing a creative"). Unmapped it fell to the 500 default, and
      // sanitize-errors.filter scrubs the message on any status >= 500 in EVERY
      // environment — so the owner saw "Internal server error" for something
      // they could have fixed.
      [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
      AD_NOT_FOUND: HttpStatus.NOT_FOUND,
      CAMPAIGN_NOT_FOUND: HttpStatus.NOT_FOUND,
      VIDEO_NOT_FOUND: HttpStatus.NOT_FOUND,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      // handle-meta-error.ts maps Meta's `permission_denied` category (and
      // `messaging_window` / `user_blocked`) to ErrorCodes.FORBIDDEN — this is
      // deliberate: it's a real 4xx, unlike the FORBIDDEN comment on
      // META_ACCOUNT_RESTRICTED below this is about the Meta token/scope
      // lacking a permission, not a Borradh-resource permission failure, but it
      // still needs its own 4xx status. Left unmapped it fell to the 500
      // default and `sanitize-errors.filter` scrubs every >=500 body to a
      // generic message in every environment, which is exactly what made
      // Claire's "Failed to launch ad" unrecoverable (ENG-852).
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      INVALID_AD_STATE: HttpStatus.BAD_REQUEST,
      VIDEO_NOT_READY: HttpStatus.BAD_REQUEST,
      META_NOT_CONFIGURED: HttpStatus.PRECONDITION_FAILED,
      SOCIAL_POST_NOT_ELIGIBLE: HttpStatus.BAD_REQUEST,
      META_VIDEO_UPLOAD_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
      META_AD_CREATE_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
      META_SYNC_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
      META_PAYMENT_METHOD_REQUIRED: HttpStatus.PAYMENT_REQUIRED,
      META_LEAD_GEN_TOS_REQUIRED: HttpStatus.PRECONDITION_FAILED,
      META_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
      // NOT 401. `apps/app`'s api-client clears the auth token on any 401, so a
      // 401 here logs the user out of Borradh entirely because their *Meta*
      // token expired. 409 is the deliberate choice already made in
      // `meta-campaigns.controller.ts` (ENG-311/ENG-310): a user-actionable
      // "reconnect Meta" condition, not "your Borradh session died".
      META_AUTH_EXPIRED: HttpStatus.CONFLICT,
      META_USER_ACTION_REQUIRED: HttpStatus.PRECONDITION_FAILED,
      // A restricted ad account is user-actionable, not a permission failure on
      // a Borradh resource — keep `FORBIDDEN` meaning only the latter.
      META_ACCOUNT_RESTRICTED: HttpStatus.UNPROCESSABLE_ENTITY,
      // Something must be fixed in Meta before this can work — same family as
      // META_NOT_CONFIGURED / META_LEAD_GEN_TOS_REQUIRED.
      META_PAGE_NOT_ACCESSIBLE: HttpStatus.PRECONDITION_FAILED,
      // Meta cannot process the requested WhatsApp destination. 4xx (not 500) so
      // the sanitize-errors filter keeps the actionable message — Claire's
      // createCampaign tool reads it to fall back to Messenger. Matches the
      // status `meta-campaigns.controller.ts` already returns for these.
      META_WHATSAPP_DISCONNECTED: HttpStatus.UNPROCESSABLE_ENTITY,
      META_WHATSAPP_PHONE_NOT_LINKED: HttpStatus.UNPROCESSABLE_ENTITY,
      META_WHATSAPP_FREE_NUMBER_INELIGIBLE: HttpStatus.UNPROCESSABLE_ENTITY,
    };

    const status = statusMap[error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    // Pass structured error body (code + details) so the frontend can
    // identify the specific error type and show contextual help.
    return new HttpException(
      {
        message: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
      status
    );
  }

  // ==================== WEBHOOK ENDPOINTS (No Auth) ====================

  /**
   * Meta webhook verification endpoint. Called by Meta when setting up
   * webhooks; `HubChallenge` does the constant-time `hub.verify_token`
   * comparison and this echoes the nonce back.
   */
  @Public()
  @HubChallenge({
    operation: 'metaAds.webhookVerify',
    feature: 'metaAds',
    unconfiguredError: 'verify token unset',
    unconfiguredMessage: 'Webhook not configured',
    forbiddenMessage: 'Verification failed',
  })
  @Get('webhook')
  async verifyWebhook(@HubChallengeEcho() challenge: string) {
    return challenge;
  }

  /**
   * Meta webhook event handler — status changes, deletions, etc.
   *
   * `@Res()` is deliberate: the missing-signature case must answer `400` with
   * the BARE string body `Missing signature`, not a JSON error envelope, and
   * Meta's retry backoff keys off that status.
   */
  @Public()
  @Post('webhook')
  async handleWebhookEvent(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response
  ) {
    const ack = await acknowledgeMetaAdsWebhook(db, {
      payload: req.body,
      signature: req.headers['x-hub-signature-256'] as string | undefined,
      rawBody: req.rawBody?.toString() || '',
      appSecret: apiEnv.META_APP_SECRET,
    });

    return 'text' in ack
      ? res.status(ack.status).send(ack.text)
      : res.status(ack.status).json(ack.body);
  }

  // ==================== AUTHENTICATED ENDPOINTS ====================

  @Get('health-check')
  async healthCheck(
    @ActiveOrganization() orgId: string | undefined,
    @Query('metaAdsPageId') metaAdsPageId?: string,
    @Query('requireInstagram') requireInstagram?: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await healthCheck(db, {
      organizationId,
      metaAdsPageId: metaAdsPageId || undefined,
      requireInstagram: requireInstagram === 'true',
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @MediaUrls({
    collection: 'ads',
    fields: [
      VIDEO_THUMBNAIL_URL,
      { path: 'video.videoUrl', strategy: 'media' },
      GRAPHIC_IMAGE_URL,
    ],
    strip: ['graphicImageKey'],
  })
  @Get('campaigns/:metaCampaignId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @Param('metaCampaignId') metaCampaignId: string,
    @ActiveOrganization() orgId: string | undefined,
    @Query() query: ListAdsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await listAds(db, {
      metaCampaignId,
      organizationId,
      status: query.status,
      limit: query.limit || 50,
      offset: query.offset || 0,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('import')
  async importAds(@ActiveOrganization() orgId: string | undefined) {
    this.logger.log('Import Meta ads request');
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await importMetaAds(db, { organizationId });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `Import complete: ${result.data.imported} imported, ${result.data.updated} updated`
    );
    return result.data;
  }

  @MediaUrls({
    fields: [
      VIDEO_THUMBNAIL_URL,
      { path: 'video.blobUrl', strategy: 'media' },
      GRAPHIC_IMAGE_URL,
    ],
    strip: ['graphicImageKey'],
  })
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await getAd(db, { adId: id, organizationId });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post()
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ActiveOrganization() orgId: string | undefined,
    @Body() createAdDto: CreateAdDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    // `callToAction` defaults to LEARN_MORE in `createAdSchema` itself, so the
    // DTO carries the default through and nothing needs restating here.
    const result = await createAd(db, { ...createAdDto, organizationId });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('launch')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async launch(
    @ActiveOrganization() orgId: string | undefined,
    @Body() launchAdDto: LaunchAdDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await launchAndFinalizeAd(db, {
      ...launchAdDto,
      organizationId,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('launch-from-post')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async launchFromPost(
    @ActiveOrganization() orgId: string | undefined,
    @Body() dto: LaunchAdFromPostDto
  ) {
    this.logger.log(
      `Launch ad from post request - socialPostId: ${dto.socialPostId}, metaCampaignId: ${dto.metaCampaignId}`
    );
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await launchAdFromPost(db, {
      ...dto,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Launch ad from post failed - code: ${result.error.code}, message: ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Ad from post launched successfully: ${result.data.ad.id}`);
    return result.data;
  }

  @Put(':id')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined,
    @Body() updateAdDto: UpdateAdDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await updateAd(db, {
      ...updateAdDto,
      adId: id,
      organizationId,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Put(':id/creative')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async replaceCreative(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined,
    @Body() dto: ReplaceAdCreativeDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await replaceAdCreative(db, {
      adId: id,
      organizationId,
      ...dto,
    });
    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }
    return result.data;
  }

  @Post(':id/publish')
  @RequireRole('admin')
  async publish(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log(`Publish ad request for ID: ${id}`);
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await publishAd(db, {
      adId: id,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Ad published successfully: ${id}`);
    return result.data;
  }

  /**
   * Promote a chat-owned draft ad to live. Used by Window 7's chat
   * preview card Publish button — the card persists field edits via
   * the standard PUT first, then calls this endpoint to actually
   * launch the ad through Meta. Service-level validation lives in
   * `promoteDraftAd`.
   */
  @Post(':id/promote-draft')
  @RequireRole('admin')
  async promoteDraft(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log(`Promote draft ad request for ID: ${id}`);
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await promoteDraftAd(db, {
      draftId: id,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `Draft ad promoted successfully: ${id} -> ${result.data.ad.id}`
    );
    return result.data;
  }

  @Delete(':id')
  @RequireRole('admin')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log(`Delete ad request for ID: ${id}`);
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await deleteAd(db, {
      adId: id,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Ad deleted successfully: ${id}`);
    return { success: true };
  }

  @Post(':id/duplicate')
  @RequireRole('admin')
  async duplicate(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log(`Duplicate ad request for ID: ${id}`);
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await duplicateAd(db, {
      adId: id,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Ad duplicated successfully: ${id} -> ${result.data.id}`);
    return result.data;
  }

  @Post(':id/sync')
  async syncStatus(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    this.logger.log(`Sync ad status request for ID: ${id}`);
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await syncAdStatus(db, {
      adId: id,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Ad status synced successfully: ${id}`);
    return result.data;
  }
}
