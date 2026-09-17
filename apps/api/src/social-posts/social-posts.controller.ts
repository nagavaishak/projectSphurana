import {
  listSocialPostsResponseSchema,
  socialPostSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  createSocialPost,
  deleteSocialPost,
  getPostEngagement,
  getSocialPost,
  listSocialPosts,
  startSocialPostPublish,
  suggestPostingTime,
  syncSocialPosts,
  updateSocialPost,
} from '@borradh-workspace/features/social-posts';
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
} from '@nestjs/common';
import { MediaUrls } from '../common/decorators/media-urls.decorator.js';
import {
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  RequireRole,
  ResponseContract,
  RoleGuard,
} from '../common/index.js';
import { MediaUrlInterceptor } from '../common/interceptors/media-url.interceptor.js';
import { CreateSocialPostDto } from './dto/create-social-post.dto.js';
import { ListSocialPostsDto } from './dto/list-social-posts.dto.js';
import { UpdateSocialPostDto } from './dto/update-social-post.dto.js';

/**
 * Media URLs on the read routes are re-signed by `MediaUrlInterceptor` from the
 * `@MediaUrls` spec on each route — see
 * `apps/api/src/common/interceptors/media-url.interceptor.ts`. Routes without
 * that decorator (notably `POST :id/publish`) are deliberately left unsigned.
 */
const POST_MEDIA_FIELDS = [
  { path: 'mediaUrl', strategy: 'cdn' },
  { path: 'thumbnailUrl', strategy: 'cdn' },
] as const;

@Controller('social-posts')
@UseGuards(AuthGuard, RoleGuard)
@UseInterceptors(MediaUrlInterceptor)
export class SocialPostsController {
  private readonly logger = new Logger(SocialPostsController.name);

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

  /**
   * Scheduled posts are NOT handed to Meta here. The scheduler's
   * publish-due-posts runner fires every scheduled post at its time via
   * `publishSocialPost` (immediate publish, FB + standalone IG). This avoids
   * Meta's native-scheduling 10-minute minimum (which silently rejected
   * near-term posts with "#100 invalid scheduled publish time") and gives a
   * single publish path for both manual and content-batch posts.
   *
   * "Post now" requests are published explicitly by the frontend via
   * `POST :id/publish`.
   */
  @Post()
  @RequireRole('admin')
  async create(
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string,
    @Body() createDto: CreateSocialPostDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await createSocialPost(db, {
      ...createDto,
      organizationId,
      createdById: userId,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @ResponseContract(listSocialPostsResponseSchema)
  @MediaUrls({ collection: 'items', fields: [...POST_MEDIA_FIELDS] })
  @Get()
  async findAll(
    @ActiveOrganization() orgId: string | undefined,
    @Query() listDto: ListSocialPostsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await listSocialPosts(db, { ...listDto, organizationId });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Get('suggest-timing')
  async suggestTiming(
    @ActiveOrganization() orgId: string | undefined,
    @Query('platform') platform?: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await suggestPostingTime(db, {
      organizationId,
      platform: platform as 'facebook' | 'instagram' | undefined,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id/engagement')
  async getEngagement(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Query('platform') platform?: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await getPostEngagement(db, {
      socialPostId: id,
      organizationId,
      platform: platform as 'facebook' | 'instagram' | undefined,
    });

    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @ResponseContract(socialPostSchema)
  @MediaUrls({ fields: [...POST_MEDIA_FIELDS] })
  @Get(':id')
  async findOne(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await getSocialPost(db, { id, organizationId });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Put(':id')
  @RequireRole('admin')
  async update(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() updateDto: UpdateSocialPostDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Update social post request for ID: ${id}`);

    const result = await updateSocialPost(db, {
      id,
      organizationId,
      ...updateDto,
    });

    if (!result.success) {
      this.logger.warn(
        `Update social post failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Social post updated successfully: ${id}`);
    return result.data;
  }

  @Delete(':id')
  @RequireRole('admin')
  async remove(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Delete social post request for ID: ${id}`);

    const result = await deleteSocialPost(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Delete social post failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Social post deleted successfully: ${id}`);
    return { success: true };
  }

  @Post('sync')
  async sync(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Sync social posts request for organization: ${organizationId}`
    );

    const result = await syncSocialPosts(db, { organizationId });

    if (!result.success) {
      this.logger.warn(
        `Sync social posts failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `Sync complete: checked=${result.data.checked}, deleted=${result.data.deleted}`
    );
    return result.data;
  }

  @Post(':id/publish')
  @RequireRole('admin')
  async publish(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await startSocialPostPublish(db, { id, organizationId });

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
