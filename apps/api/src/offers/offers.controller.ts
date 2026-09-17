import {
  listOffersResponseSchema,
  offerWithServicesSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import { promoteDraftOffer } from '@borradh-workspace/features/claire';
import {
  addOfferLocations,
  createOffer,
  deleteOffer,
  getOffer,
  listOffers,
  removeOfferLocation,
  updateOffer,
} from '@borradh-workspace/features/offers';
import { ErrorCodes } from '@borradh-workspace/features/shared';
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
import {
  ActiveLocation,
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  RequireRole,
  ResponseContract,
  RoleGuard,
} from '../common/index.js';
import type {
  AddOfferLocationsDto,
  CreateOfferDto,
  ListOffersDto,
  UpdateOfferDto,
} from './dto/index.js';

@Controller('offers')
@UseGuards(AuthGuard, RoleGuard)
export class OffersController {
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

  @Post()
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @Body() dto: CreateOfferDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await createOffer(db, { ...dto, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @ResponseContract(listOffersResponseSchema)
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @Query() dto: ListOffersDto,
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listOffers(db, { ...dto, organizationId, locationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @ResponseContract(offerWithServicesSchema)
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await getOffer(db, { id, organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOfferDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateOffer(db, { id, organizationId, ...dto });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Also run this promotion at these branches — the write behind "import from
   * another location".
   *
   * ADDITIVE, unlike the PUT above, which takes the offer's whole shape
   * (services AND branches) and replaces it. Importing through that would mean
   * the client reconstructing every other field of an offer it is not editing.
   */
  /**
   * Stop offering this promotion at ONE branch, leaving it in place everywhere
   * else — the "remove from this location" half of the delete prompt.
   *
   * Not a DELETE of the record: the record is shared across branches, so the
   * page-level delete would take it off all of them. Removing the LAST branch
   * is refused (409) rather than performed, because zero rows reads as "every
   * branch" — deactivating is how a business withdraws something outright.
   */
  @Delete(':id/locations/:locationId')
  @RequireRole('admin')
  async removeLocation(
    @Param('id') offerId: string,
    @Param('locationId') locationId: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await removeOfferLocation(db, {
      offerId,
      locationId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Post(':id/locations')
  @RequireRole('admin')
  @UsePipes(new ValidationPipe({ transform: true }))
  async addLocations(
    @Param('id') offerId: string,
    @Body() dto: AddOfferLocationsDto,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await addOfferLocations(db, {
      ...dto,
      offerId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /**
   * Promote a chat-owned draft offer (state='draft') to active. Used by
   * Window 7's chat preview card Publish button — final field edits are
   * persisted via the standard PUT first, then this endpoint flips the
   * state. `promoteDraftOffer` re-validates discount-shape invariants.
   */
  @Post(':id/promote-draft')
  @RequireRole('admin')
  async promoteDraft(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await promoteDraftOffer(db, {
      draftId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  @RequireRole('admin')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await deleteOffer(db, {
      id,
      organizationId,
      actorId: userId,
    });
    if (!result.success) throw this.mapError(result.error);
    return { success: true };
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      // INVALID_STATE is a user-actionable state conflict ("already promoted",
      // "missing a creative"). Unmapped it fell to the 500 default, and
      // sanitize-errors.filter scrubs the message on any status >= 500 in EVERY
      // environment — so the owner saw "Internal server error" for something
      // they could have fixed.
      [ErrorCodes.INVALID_STATE]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
