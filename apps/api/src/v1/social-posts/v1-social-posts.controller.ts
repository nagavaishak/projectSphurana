import { db } from '@borradh-workspace/database';
import {
  createSocialPost,
  deleteSocialPost,
  getSocialPost,
  listSocialPosts,
  publishSocialPost,
  updateSocialPost,
} from '@borradh-workspace/features/social-posts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiKeyGuard,
  ApiKeyOrganization,
  PlanAccessGuard,
  RequireScopes,
  ScopeGuard,
} from '../../common';
import { CreateSocialPostDto } from '../../social-posts/dto/create-social-post.dto.js';
import { ListSocialPostsDto } from '../../social-posts/dto/list-social-posts.dto.js';
import { UpdateSocialPostDto } from '../../social-posts/dto/update-social-post.dto.js';
import { mapError } from '../shared/map-error';

@Controller('v1/social-posts')
@UseGuards(ApiKeyGuard, PlanAccessGuard, ScopeGuard)
export class V1SocialPostsController {
  @Get()
  @RequireScopes('social-posts:read')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ApiKeyOrganization('id') organizationId: string,
    @Query() dto: ListSocialPostsDto
  ) {
    const result = await listSocialPosts(db, {
      ...dto,
      organizationId,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Get(':id')
  @RequireScopes('social-posts:read')
  async findOne(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await getSocialPost(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Post()
  @RequireScopes('social-posts:write')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ApiKeyOrganization('id') organizationId: string,
    @Body() dto: CreateSocialPostDto
  ) {
    const result = await createSocialPost(db, {
      ...dto,
      organizationId,
      createdById: 'api-key', // No user context with API key auth
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @RequireScopes('social-posts:write')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSocialPostDto
  ) {
    const result = await updateSocialPost(db, {
      id,
      organizationId,
      ...dto,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  @RequireScopes('social-posts:write')
  async remove(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await deleteSocialPost(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Post(':id/publish')
  @RequireScopes('social-posts:write')
  async publish(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await publishSocialPost(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }
}
