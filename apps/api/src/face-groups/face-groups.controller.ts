import { db } from '@borradh-workspace/database';
import {
  createManualPair,
  getBatchFaceGroups,
  getFaceGroupAssets,
  listFaceGroups,
  updateFaceGroup,
  updateFaceGroupAssetRole,
} from '@borradh-workspace/features/face-groups';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
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
import { ActiveOrganization, AuthGuard } from '../common';
import {
  CreateManualPairDto,
  ListFaceGroupsDto,
  UpdateFaceGroupAssetRoleDto,
  UpdateFaceGroupDto,
} from './dto';
import { resolveFaceGroupUrls } from './resolve-face-group-urls.js';

/**
 * Asset URL resolution for the read routes lives in
 * `resolve-face-group-urls.ts` — the payload path is `assets[].asset.blobUrl`,
 * which the `@MediaUrls` interceptor's dot-path walker cannot express.
 */
@Controller('face-groups')
@UseGuards(AuthGuard)
export class FaceGroupsController {
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async list(
    @Query() dto: ListFaceGroupsDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await listFaceGroups(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);

    return result.data;
  }

  @Get(':groupId/assets')
  async getGroupAssets(
    @Param('groupId') faceGroupId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await getFaceGroupAssets(db, {
      faceGroupId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);

    const { faceGroup, assets } = result.data;
    const transformed = await resolveFaceGroupUrls({ assets });
    return {
      faceGroup,
      assets: transformed.assets,
    };
  }

  @Get('batch/:batchId')
  async getBatchGroups(
    @Param('batchId') batchId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await getBatchFaceGroups(db, { batchId, organizationId });
    if (!result.success) throw this.mapError(result.error);

    const faceGroups = await Promise.all(
      result.data.faceGroups.map((g) => resolveFaceGroupUrls(g))
    );

    return { ...result.data, faceGroups };
  }

  @Put(':groupId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('groupId') groupId: string,
    @Body() dto: UpdateFaceGroupDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await updateFaceGroup(db, {
      id: groupId,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':groupId/assets/:assetId/role')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateAssetRole(
    @Param('groupId') faceGroupId: string,
    @Param('assetId') assetId: string,
    @Body() dto: UpdateFaceGroupAssetRoleDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await updateFaceGroupAssetRole(db, {
      faceGroupId,
      assetId,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post('manual-pair')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createManualPairEndpoint(
    @Body() dto: CreateManualPairDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await createManualPair(db, {
      ...dto,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.INVALID_INPUT]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
      [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
