import {
  getAssetResponseSchema,
  listAssetsByServiceResponseSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import {
  addAssetTags,
  createAsset,
  createUploadBatch,
  deleteAsset,
  getAsset,
  getAssetAnalysis,
  getBulkAssetsStatus,
  linkAssetServices,
  listAssets,
  listAssetsByService,
  listBatchAssets,
  queueAssetAnalysis,
  removeAssetTags,
  reprobeAsset,
  unlinkAssetServices,
  updateAssetContentType,
  updateAssetTags,
} from '@borradh-workspace/features/assets';
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
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  type AuthenticatedRequest,
  CurrentUser,
  RequireRole,
  ResponseContract,
  RoleGuard,
} from '../common';
import { MediaUrls } from '../common/decorators/media-urls.decorator.js';
import { MediaUrlInterceptor } from '../common/interceptors/media-url.interceptor.js';
import {
  CreateAssetDto,
  GetBulkAssetsStatusQueryDto,
  ListAssetsQueryDto,
  ListBatchAssetsQueryDto,
  RemoveAssetTagsDto,
  UnlinkAssetServicesDto,
  UpdateAssetContentTypeDto,
} from './dto/index.js';

/**
 * Asset URL resolution (CDN vs presigned S3) is applied by `MediaUrlInterceptor`
 * from the `@MediaUrls` spec on each read route — see
 * `apps/api/src/common/interceptors/media-url.interceptor.ts`.
 */
const BLOB_URL = { path: 'blobUrl', strategy: 'asset' } as const;
const THUMBNAIL_URL = { path: 'thumbnailUrl', strategy: 'asset' } as const;

/**
 * ROLE POLICY. This controller carried NO role gate at all — every route was
 * `AuthGuard` only, and `RoleGuard` is opt-in per controller (the only global
 * guards are `FlyThrottlerGuard` and `MemberGuard`, and `MemberGuard` checks
 * MEMBERSHIP, not role). So any authenticated member could permanently delete
 * any asset in the org.
 *
 * The gate added here is deliberately narrow — `DELETE /assets/:id` only:
 *
 *   - reads stay open. Members need the media library to do their jobs.
 *   - uploads stay open. Staff photographing work is the normal path, and an
 *     unwanted upload is reversible by an admin.
 *   - tagging / service-linking / content-type stay open. They are curation:
 *     annoying to undo, but nothing is lost.
 *   - deleting the asset is the one IRREVERSIBLE action, and it destroys work
 *     that other people's videos and ads reference. That is the one gated.
 *
 * Widening this further is a product call, not a security one; it should be
 * made deliberately rather than by extending this comment.
 *
 * SCOPE OF THIS CONTROL. It constrains HUMAN MEMBERS on the session API only.
 * `DELETE /v1/assets/:id` (`v1/assets/v1-assets.controller.ts`) is reachable by
 * any API key holding `assets:write`, and no role gate can apply there: a v1
 * key is an ORG-level credential with no `member` row, so `RoleGuard` — which
 * resolves a role by userId — has nothing to resolve. That is the intended
 * model (whoever mints the key decides its scopes), not a bypass to close, but
 * do not read the decorator below as "only admins can ever delete an asset".
 *
 * KNOWN GAP: the frontend delete button is NOT role-gated, so a member still
 * sees it and gets a 403 toast reading "admin role or higher required". Gating
 * it needs the caller's own role exposed to the client, which no endpoint does
 * today. Tracked as a follow-up; the 403 is correct and the asset survives.
 */
@Controller('assets')
@UseGuards(AuthGuard, RoleGuard)
@UseInterceptors(MediaUrlInterceptor)
export class AssetsController {
  private readonly logger = new Logger(AssetsController.name);

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

  @MediaUrls({
    collection: 'items',
    fields: [BLOB_URL, THUMBNAIL_URL],
    honorUrlFormatQuery: true,
  })
  @Get()
  async findAll(
    @ActiveOrganization() orgId: string | undefined,
    @Query() query: ListAssetsQueryDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await listAssets(db, { ...query, organizationId });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @MediaUrls({ collection: 'items', fields: [BLOB_URL, THUMBNAIL_URL] })
  @ResponseContract(listAssetsByServiceResponseSchema)
  @Get('by-service/:serviceId')
  async findByService(
    @ActiveOrganization() orgId: string | undefined,
    @Param('serviceId') serviceId: string,
    @Query('type') type?: 'video' | 'image'
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await listAssetsByService(db, {
      serviceId,
      organizationId,
      type,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return { items: result.data };
  }

  /**
   * Analysis status for many assets at once.
   *
   * MUST stay registered above `@Get(':id')` — Nest matches in declaration
   * order, so a single-segment literal declared after the id param is never
   * reached.
   *
   * Exists so a client tracking an upload polls once for the whole batch
   * instead of once per asset. A twenty-video upload previously opened twenty
   * independent polling loops against `GET /assets/:id/analysis`.
   */
  // role-guard-exempt: org-scoped read of the caller's own assets, returning a
  // strict subset of what `GET /assets` already gives every org member.
  @Get('bulk-status')
  @UsePipes(new ValidationPipe({ transform: true }))
  async bulkStatus(
    @ActiveOrganization() orgId: string | undefined,
    @Query() query: GetBulkAssetsStatusQueryDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await getBulkAssetsStatus(db, {
      organizationId,
      batchId: query.batchId,
      assetIds: query.assetIds,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @ResponseContract(getAssetResponseSchema)
  @MediaUrls({ fields: [BLOB_URL] })
  @Get(':id')
  async findOne(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await getAsset(db, { id, organizationId });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    if (!result.data) {
      throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
    }
    return result.data;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() orgId: string | undefined,
    @Body() createAssetDto: CreateAssetDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await createAsset(db, {
      ...createAssetDto,
      tags: createAssetDto.tags || [],
      type: createAssetDto.type || 'video',
      organizationId,
      uploadedById: user.id,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post('batch')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createBatch(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @ActiveOrganization() orgId: string | undefined,
    @Body() body: { totalAssets: number }
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await createUploadBatch(db, {
      totalAssets: body.totalAssets,
      organizationId,
      createdById: user.id,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Delete(':id')
  @RequireRole('admin')
  async remove(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Delete asset request for ID: ${id}`);

    const result = await deleteAsset(db, {
      id,
      organizationId,
      actorId: userId,
    });

    if (!result.success) {
      this.logger.warn(
        `Delete asset failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Asset deleted successfully: ${id}`);
    return result.data;
  }

  // =============== Batch Assets Endpoints ===============

  @MediaUrls({ collection: 'items', fields: [BLOB_URL] })
  @Get('batch/:batchId')
  async listBatchAssets(
    @ActiveOrganization() orgId: string | undefined,
    @Param('batchId') batchId: string,
    @Query() query: ListBatchAssetsQueryDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await listBatchAssets(db, {
      ...query,
      batchId,
      organizationId,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Put(':id/content-type')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateContentType(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAssetContentTypeDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await updateAssetContentType(db, {
      assetId: id,
      organizationId,
      ...dto,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  // =============== Asset Analysis Endpoints ===============

  /**
   * Trigger AI analysis for an asset (video)
   */
  @Post(':id/analyze')
  async analyze(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Queue asset analysis request for ID: ${id}`);

    const result = await queueAssetAnalysis(db, {
      assetId: id,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Queue analysis failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Asset analysis queued: ${id}`);
    return result.data;
  }

  /**
   * Re-probe a video asset whose ffprobe step failed (ENG-375 recovery).
   * Resets probe/transcode status and re-enqueues the probe job so the asset
   * becomes usable in renders again without a delete + re-upload.
   */
  @Post(':id/reprobe')
  async reprobe(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Re-probe request for asset ID: ${id}`);

    const result = await reprobeAsset(db, { assetId: id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Re-probe failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Asset re-probe queued: ${id}`);
    return result.data;
  }

  /**
   * Get AI analysis results for an asset
   */
  @Get(':id/analysis')
  async getAnalysis(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Get asset analysis request for ID: ${id}`);

    const result = await getAssetAnalysis(db, {
      assetId: id,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Get analysis failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * Link services to an asset
   */
  @Post(':id/services')
  @UsePipes(new ValidationPipe({ transform: true }))
  async linkServices(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() body: { serviceIds: string[] }
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Link services to asset: ${id}`);

    const result = await linkAssetServices(db, {
      assetId: id,
      organizationId,
      serviceIds: body.serviceIds,
      isManual: true,
    });

    if (!result.success) {
      this.logger.warn(
        `Link services failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * Unlink services from an asset
   */
  @Delete(':id/services')
  @UsePipes(new ValidationPipe({ transform: true }))
  async unlinkServices(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() body: UnlinkAssetServicesDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Unlink services from asset: ${id}`);

    const result = await unlinkAssetServices(db, {
      assetId: id,
      organizationId,
      serviceIds: body.serviceIds,
    });

    if (!result.success) {
      this.logger.warn(
        `Unlink services failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * Replace all tags on an asset
   */
  @Put(':id/tags')
  @UsePipes(new ValidationPipe({ transform: true }))
  async replaceTags(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() body: { tags: string[] }
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Replace tags on asset: ${id}`);

    const result = await updateAssetTags(db, {
      assetId: id,
      organizationId,
      tags: body.tags,
    });

    if (!result.success) {
      this.logger.warn(
        `Replace tags failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * Add tags to an asset (merge with existing)
   */
  @Post(':id/tags')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addTags(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() body: { tags: string[] }
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Add tags to asset: ${id}`);

    const result = await addAssetTags(db, {
      assetId: id,
      organizationId,
      tags: body.tags,
    });

    if (!result.success) {
      this.logger.warn(
        `Add tags failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  /**
   * Remove specific tags from an asset
   */
  @Delete(':id/tags')
  @UsePipes(new ValidationPipe({ transform: true }))
  async removeTags(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() body: RemoveAssetTagsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Remove tags from asset: ${id}`);

    const result = await removeAssetTags(db, {
      assetId: id,
      organizationId,
      tags: body.tags,
    });

    if (!result.success) {
      this.logger.warn(
        `Remove tags failed: ${result.error.code} - ${result.error.message}`
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
