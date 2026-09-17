import { db } from '@borradh-workspace/database';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  createOrganizationPhoto,
  deleteOrganizationPhoto,
  listOrganizationPhotos,
  reorderOrganizationPhotos,
  setCoverPhoto,
  updateLocationVenue,
} from '@borradh-workspace/features/venue';
import {
  Body,
  Controller,
  Delete,
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
import { ActiveOrganization, AuthGuard } from '../common/index.js';
import {
  CreateOrganizationPhotoDto,
  ReorderOrganizationPhotosDto,
  SetCoverPhotoDto,
  UpdateLocationVenueDto,
} from './dto/index.js';

/**
 * Dashboard (authenticated) venue management: a location's "about" + amenities
 * (+ slug) and its gallery photos (CRUD, reorder, set-cover). A venue IS a
 * location, so every route targets a locationId; every write is scoped to the
 * caller's active organization.
 */
@Controller('venue')
@UseGuards(AuthGuard)
export class VenueController {
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

  @Put(':locationId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateVenue(
    @Param('locationId') locationId: string,
    @Body() dto: UpdateLocationVenueDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateLocationVenue(db, {
      organizationId,
      locationId,
      ...dto,
    });
    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }
    return result.data;
  }

  @Get('photos')
  async listPhotos(
    @Query('locationId') locationId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listOrganizationPhotos(db, {
      organizationId,
      locationId,
    });
    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }
    return result.data;
  }

  @Post('photos')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createPhoto(
    @Body() dto: CreateOrganizationPhotoDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createOrganizationPhoto(db, {
      organizationId,
      ...dto,
    });
    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }
    return result.data;
  }

  @Post('photos/reorder')
  @UsePipes(new ValidationPipe({ transform: true }))
  async reorderPhotos(
    @Body() dto: ReorderOrganizationPhotosDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await reorderOrganizationPhotos(db, {
      organizationId,
      ...dto,
    });
    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }
    return result.data;
  }

  @Post('photos/cover')
  @UsePipes(new ValidationPipe({ transform: true }))
  async setCover(
    @Body() dto: SetCoverPhotoDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await setCoverPhoto(db, { organizationId, ...dto });
    if (!result.success) {
      throw this.mapErrorToHttpException(result.error);
    }
    return result.data;
  }

  @Delete('photos/:id')
  async deletePhoto(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteOrganizationPhoto(db, { id, organizationId });
    if (!result.success) {
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
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
