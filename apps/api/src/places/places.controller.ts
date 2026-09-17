import {
  getPlaceDetails,
  searchPlaces,
} from '@borradh-workspace/features/places';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/index.js';

@Controller('places')
@UseGuards(AuthGuard)
export class PlacesController {
  @Get('autocomplete')
  async autocomplete(
    @Query('query') query: string,
    @Query('sessionToken') sessionToken?: string
  ) {
    const result = await searchPlaces({ query, sessionToken });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get('details')
  async details(
    @Query('placeId') placeId: string,
    @Query('sessionToken') sessionToken?: string
  ) {
    const result = await getPlaceDetails({ placeId, sessionToken });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
