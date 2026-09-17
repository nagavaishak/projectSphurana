import { db } from '@borradh-workspace/database';
import {
  createContent,
  reviseContent,
} from '@borradh-workspace/features/content-items';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  listStockClipPreviews,
  mintStockAssets,
} from '@borradh-workspace/features/stock-footage';
import {
  addDraftClips,
  addVideoClip,
  cleanupOrphanedAssets,
  deleteVideo,
  generateOrganicCopy,
  generateVideoScript,
  getDeadLetterQueueStats,
  getQueueStats,
  getVideo,
  getVideoJobStatus,
  getVideoSlotStatus,
  listDeadLetterJobs,
  listDraftClips,
  listInProgressVideos,
  listVideos,
  previewTemplateRender,
  queueVideoExport,
  retryFailedJob,
  retryFromDeadLetterQueue,
  synthesizeTemplate,
  transcribeVideo,
  updateDraftClips,
  updateVideo,
  validateDraftConfig,
} from '@borradh-workspace/features/videos';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  type AuthenticatedRequest,
  CurrentUser,
  VideoOwnershipGuard,
  WhatsappDelivery,
  type WhatsappDeliveryTag,
} from '../common';
import {
  MediaUrls,
  type MediaUrlsSpec,
} from '../common/decorators/media-urls.decorator.js';
import { MediaUrlInterceptor } from '../common/interceptors/media-url.interceptor.js';
import type {
  AddDraftClipDto,
  AddDraftClipsBatchDto,
  AddVideoClipDto,
  CreateVideoDto,
  GenerateOrganicCopyDto,
  GenerateVideoScriptDto,
  PatchDraftConfigDto,
  UpdateDraftClipsDto,
  UpdateVideoDto,
} from './dto/index.js';

/**
 * Media URL resolution is applied by `MediaUrlInterceptor` from the
 * `@MediaUrls` spec on each read route — see
 * `apps/api/src/common/interceptors/media-url.interceptor.ts`. The specs live
 * out here (rather than inline) so each decorator stays a single line.
 */
const LIST_MEDIA_URLS: MediaUrlsSpec = {
  collection: 'items',
  fields: [
    // blobUrl is deliberately withheld on the list: the browser would otherwise
    // preload full video files whenever a thumbnail is missing, and clicking a
    // video fetches GET /videos/:id anyway. Halves the presign calls too.
    { path: 'blobUrl', strategy: 'blank' },
    { path: 'thumbnailUrl', strategy: 'video' },
  ],
  // ?urlFormat=presigned bypasses CDN — needed for native media players.
  honorUrlFormatQuery: true,
};

const DETAIL_MEDIA_URLS: MediaUrlsSpec = {
  fields: [
    { path: 'blobUrl', strategy: 'video' },
    { path: 'thumbnailUrl', strategy: 'video' },
  ],
};

const STOCK_CLIP_MEDIA_URLS: MediaUrlsSpec = {
  collection: 'items',
  fields: [{ path: 'previewUrl', strategy: 'video' }],
  // The picker plays previews inline in the browser, which never carries
  // CloudFront signed cookies — always presign.
  alwaysPresigned: true,
};

@Controller('videos')
@UseGuards(AuthGuard)
@UseInterceptors(MediaUrlInterceptor)
export class VideosController {
  @Post(':id/synthesize')
  async synthesizeV2(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await synthesizeTemplate(db, {
      videoId: id,
      organizationId,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  /**
   * Render a single template through either the legacy engine (`v1`) or the
   * renderdoc engine (`v2`) so the two can be compared side-by-side in the
   * template-feedback page. All of the work — synthesising the same full
   * draftConfig a one-prompt create would, then dispatching to the v1 or v2
   * pipeline — lives in `previewTemplateRender`.
   *
   * Returns `{ videoId }`; the frontend polls `GET /videos/:id` for status +
   * presigned `blobUrl`.
   */
  @Post('template-preview')
  async templatePreview(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() organizationId: string,
    @Body()
    body: {
      templateId?: string;
      variationId?: string;
      format?: string;
      serviceId?: string;
      offerId?: string;
      version: 'v1' | 'v2';
    }
  ) {
    const result = await previewTemplateRender(db, {
      ...body,
      organizationId,
      createdById: user.id,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  private readonly logger = new Logger(VideosController.name);

  @Get()
  @MediaUrls(LIST_MEDIA_URLS)
  async findAll(
    @ActiveOrganization() organizationId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const result = await listVideos(db, {
      organizationId,
      limit: limit ? Number.parseInt(limit, 10) : 50,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Get('in-progress')
  async findInProgress(
    @ActiveOrganization() organizationId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    this.logger.log(
      `List in-progress videos request for organization: ${organizationId}`
    );

    const result = await listInProgressVideos(db, {
      organizationId,
      limit: limit ? Number.parseInt(limit, 10) : 50,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });

    if (!result.success) {
      this.logger.warn(
        `List in-progress videos failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get('queue/status')
  async getQueueStatusEndpoint() {
    this.logger.log('Get queue status request');

    const result = await getQueueStats();

    if (!result.success) {
      this.logger.warn(
        `Get queue status failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get('admin/dlq')
  async listDlqJobs(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const result = await listDeadLetterJobs(
      limit ? Number.parseInt(limit, 10) : 20,
      offset ? Number.parseInt(offset, 10) : 0
    );
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Get('admin/dlq/stats')
  async getDlqStats() {
    const result = await getDeadLetterQueueStats();
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('admin/dlq/:jobId/retry')
  async retryDlqJob(@Param('jobId') jobId: string) {
    const result = await retryFromDeadLetterQueue(jobId);
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('admin/cleanup-orphaned-assets')
  async cleanupOrphanedAssetsEndpoint(
    @ActiveOrganization() organizationId: string,
    @Query('dryRun') dryRun?: string
  ) {
    const result = await cleanupOrphanedAssets(db, {
      organizationId,
      dryRun: dryRun === 'true',
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post('generate-script')
  @UsePipes(new ValidationPipe({ transform: true }))
  async generateScript(
    @ActiveOrganization() organizationId: string,
    @Body() dto: GenerateVideoScriptDto
  ) {
    const result = await generateVideoScript(db, {
      ...dto,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * Generate AI copy for one of the 4 organic video templates. Returns a
   * discriminated union the frontend pipes straight into the matching
   * `draftConfig.{captionTease|insOuts|questionCta|improves}` block.
   */
  @Post('generate-organic-copy')
  @UsePipes(new ValidationPipe({ transform: true }))
  async generateOrganicCopy(
    @ActiveOrganization() organizationId: string,
    @Body() dto: GenerateOrganicCopyDto
  ) {
    const result = await generateOrganicCopy(db, {
      ...dto,
      organizationId,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post(':id/transcribe')
  @UseGuards(VideoOwnershipGuard)
  async transcribe(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await transcribeVideo(db, { id, organizationId });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id/validate')
  @UseGuards(VideoOwnershipGuard)
  async validateConfig(@Param('id') id: string) {
    const result = await validateDraftConfig(db, { id });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * Curated stock clips a service can pick from in the generate dialogs, with
   * presigned preview URLs. Declared before `@Get(':id')` so the static path
   * wins route matching.
   */
  @Get('stock-clips')
  @MediaUrls(STOCK_CLIP_MEDIA_URLS)
  async listStockClips(
    @ActiveOrganization() organizationId: string,
    @Query('serviceId') serviceId?: string,
    @Query('mediaType') mediaType?: 'video' | 'image'
  ) {
    const result = await listStockClipPreviews(db, {
      organizationId,
      serviceId: serviceId ?? null,
      mediaType: mediaType === 'image' ? 'image' : 'video',
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  /**
   * Copy-on-attach: mint org-owned `asset` rows for the picked stock clips so
   * they can be added to `bRollClips` exactly like uploaded footage.
   */
  @Post('stock-clips/mint')
  @UsePipes(new ValidationPipe({ transform: true }))
  async mintStockClips(
    @ActiveOrganization() organizationId: string,
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() body: { stockClipIds?: string[] }
  ) {
    const stockClipIds = Array.isArray(body?.stockClipIds)
      ? body.stockClipIds
      : [];
    if (stockClipIds.length === 0) return { assetIds: {} };

    const result = await mintStockAssets(db, {
      organizationId,
      uploadedById: user.id,
      stockClipIds,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return { assetIds: result.data };
  }

  @Get(':id')
  @UseGuards(VideoOwnershipGuard)
  @MediaUrls(DETAIL_MEDIA_URLS)
  async findOne(@Param('id') id: string) {
    const result = await getVideo(db, { id });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Get(':id/slots')
  @UseGuards(VideoOwnershipGuard)
  async getSlots(@Param('id') id: string) {
    const result = await getVideoSlotStatus(db, { videoId: id });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post(':id/clips')
  @UseGuards(VideoOwnershipGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async addClip(
    @Param('id') id: string,
    @Body() addVideoClipDto: AddVideoClipDto
  ) {
    const result = await addVideoClip(db, { videoId: id, ...addVideoClipDto });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Chat-native clip tray (W-C10-clip-tray)
  // ──────────────────────────────────────────────────────────────────────

  @Get(':id/draft-clips')
  async listDraftClipsForVideo(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await listDraftClips(db, { videoId: id, organizationId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  /**
   * Accepts BOTH a batch (`{ clips: [...] }`) and a single clip
   * (`{ assetId, source, ... }`), and answers in kind — `{ clips: [...] }` vs
   * the bare row. `videos_autoSelectClips` depends on the first shape, the
   * frontend single-drop handler on the second.
   */
  @Post(':id/draft-clips')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addDraftClipForVideo(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @Body() body: AddDraftClipDto | AddDraftClipsBatchDto
  ) {
    const result = await addDraftClips(db, {
      ...body,
      videoId: id,
      organizationId,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Put(':id/draft-clips')
  @UsePipes(new ValidationPipe({ transform: true }))
  async replaceDraftClipsForVideo(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @Body() dto: UpdateDraftClipsDto
  ) {
    const result = await updateDraftClips(db, {
      videoId: id,
      organizationId,
      clips: dto.clips,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  /**
   * Create a video. Accepts partial input for the W3 one-prompt creation flow:
   *
   *   - Minimum: `{ format }` or `{ templateId }` → `createVideoFromRequest`
   *     synthesises the full draftConfig from org defaults + the template
   *     definition + an optional service.
   *   - Maximum: legacy wizard payload with the full `draftConfig` — passed
   *     through to `createVideo` unchanged.
   *
   * When the caller supplies a partial `draftConfig`, it merges over the
   * synthesised defaults (caller wins).
   *
   * Via `createContent`, so the video is opened as attempt 0 of a content item
   * — the same thing `POST /graphics/generate` has always done. It did not, and
   * three assistant tools compensated by reaching past HTTP into the database
   * to open the item themselves. Two creates of the same kind of thing, one of
   * which knew about lineage: exactly the asymmetry that keeps producing "the
   * post may be locked" when only one branch gets a fix.
   *
   * `itemId` and `attemptNumber` ride along on the response, additively. They
   * are what a caller needs to EDIT the video afterwards — an edit addresses
   * the item, because editing a rendered video forks it and the item is what
   * follows the fork.
   */
  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() organizationId: string,
    @Body() createVideoDto: CreateVideoDto
  ) {
    const result = await createContent(db, {
      kind: 'video',
      ...createVideoDto,
      organizationId,
      createdById: user.id,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return {
      ...result.data.video,
      itemId: result.data.itemId,
      attemptNumber: result.data.attemptNumber,
      attemptId: result.data.attemptId,
    };
  }

  /**
   * Patch a draft video's config + (by default) re-queue the render.
   *
   * Used by the W3 iterate-in-chat flow:
   *   - "change the script to mention winter pricing" → `{ patch: { scriptText: '...' } }`
   *   - "make it portrait" → `{ patch: { orientation: 'portrait' } }`
   *   - "swap clip 2 for X" → `{ patch: { bRollClips: [...] } }`
   *
   * Deep-merges the partial draftConfig onto the existing one; rejects when
   * the video is mid-render (status: queued/processing). Re-queues on success.
   */
  /**
   * Editing a video that has ALREADY been rendered forks rather than
   * overwrites: the cut the owner watched and approved survives, and the edit
   * lands as the next attempt of the video's content item. An unrendered draft
   * still patches in place — there is nothing to preserve, and the wizard
   * patches on every interaction. The batch path calls `patchDraftConfig`
   * directly and is unaffected; it does its own bookkeeping.
   */
  @Patch(':id/draft-config')
  @UsePipes(new ValidationPipe({ transform: true }))
  async patchDraftConfigEndpoint(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @WhatsappDelivery() whatsappDelivery: WhatsappDeliveryTag | undefined,
    @Body() body: PatchDraftConfigDto
  ) {
    const result = await reviseContent(db, {
      kind: 'video',
      videoId: id,
      organizationId,
      patch: (body.patch ?? {}) as never,
      clipOperations: body.clipOperations,
      title: body.title,
      requeueRender: body.requeueRender ?? true,
      whatsappDelivery,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post(':id/export')
  @UseGuards(VideoOwnershipGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async queueExport(
    @Param('id') id: string,
    @WhatsappDelivery() whatsappDelivery: WhatsappDeliveryTag | undefined,
    @Body() body?: { allowStockFootage?: boolean }
  ) {
    const result = await queueVideoExport(db, {
      id,
      allowStockFootage: body?.allowStockFootage,
      whatsappDelivery,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Get(':id/job')
  @UseGuards(VideoOwnershipGuard)
  async getJobStatusEndpoint(@Param('id') id: string) {
    const result = await getVideoJobStatus(db, { videoId: id });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post(':id/retry')
  @UseGuards(VideoOwnershipGuard)
  async retryFailedJobEndpoint(@Param('id') id: string) {
    const result = await retryFailedJob(db, { videoId: id });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Put(':id')
  @UseGuards(VideoOwnershipGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() updateVideoDto: UpdateVideoDto
  ) {
    const result = await updateVideo(db, { id, ...updateVideoDto });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Delete(':id')
  @UseGuards(VideoOwnershipGuard)
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const result = await deleteVideo(db, { id, actorId: userId });
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
      case ErrorCodes.INVALID_STATE:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
