import { db } from '@borradh-workspace/database';
import {
  createAsset,
  deleteAsset,
  getAsset,
  listAssets,
} from '@borradh-workspace/features/assets';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CreateAssetDto } from '../../assets/dto/index.js';
import {
  ApiKeyGuard,
  ApiKeyOrganization,
  PlanAccessGuard,
  RequireScopes,
  ScopeGuard,
} from '../../common';
import { MediaUrls } from '../../common/decorators/media-urls.decorator.js';
import { MediaUrlInterceptor } from '../../common/interceptors/media-url.interceptor.js';
import { mapError } from '../shared/map-error';

/**
 * `blobUrl` resolution (CDN vs presigned S3) is applied by `MediaUrlInterceptor`
 * from the `@MediaUrls` spec on each read route. This controller previously
 * carried its own `extractS3Key` + `getAssetUrl` pair — a third copy of the
 * rule that already lives in `media-url.resolver.ts` as the `asset` strategy
 * (the copy `AssetsController` was migrated onto).
 */
const BLOB_URL = { path: 'blobUrl', strategy: 'asset' } as const;

@Controller('v1/assets')
@UseGuards(ApiKeyGuard, PlanAccessGuard, ScopeGuard)
@UseInterceptors(MediaUrlInterceptor)
export class V1AssetsController {
  @MediaUrls({ collection: 'items', fields: [BLOB_URL] })
  @Get()
  @RequireScopes('assets:read')
  async findAll(
    @ApiKeyOrganization('id') organizationId: string,
    @Query('type') type?: 'video' | 'image',
    @Query('tags') tags?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const result = await listAssets(db, {
      organizationId,
      type,
      tags: parseTags(tags),
      limit: limit ? Number.parseInt(limit, 10) : 50,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @MediaUrls({ fields: [BLOB_URL] })
  @Get(':id')
  @RequireScopes('assets:read')
  async findOne(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await getAsset(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    // Spread rather than return: `getAsset` can succeed with no row, and the
    // wire shape for that case has always been `{}` (a bare `blobUrl:
    // undefined`), not `null`.
    return { ...result.data };
  }

  @Post()
  @RequireScopes('assets:write')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ApiKeyOrganization('id') organizationId: string,
    @Body() dto: CreateAssetDto
  ) {
    const result = await createAsset(db, {
      ...dto,
      tags: dto.tags || [],
      type: dto.type || 'video',
      organizationId,
      uploadedById: 'api-key', // No user context with API key auth
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  @RequireScopes('assets:write')
  async remove(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await deleteAsset(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }
}

/** `?tags=a,b,c` → `['a','b','c']`; blank entries dropped, absent → undefined. */
function parseTags(tags: string | undefined): string[] | undefined {
  if (!tags) return undefined;
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}
