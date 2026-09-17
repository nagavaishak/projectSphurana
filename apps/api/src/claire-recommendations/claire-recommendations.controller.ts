import { db } from '@borradh-workspace/database';
import {
  dismissRecommendation,
  listActiveRecommendations,
  markRecommendationActioned,
} from '@borradh-workspace/features/assistant';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard } from '../common/index.js';

@Controller('claire/recommendations')
@UseGuards(AuthGuard)
export class ClaireRecommendationsController {
  private readonly logger = new Logger(ClaireRecommendationsController.name);

  @Get()
  async list(@ActiveOrganization() organizationId: string) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await listActiveRecommendations(db, { organizationId });
    if (!result.success) {
      this.logger.warn(
        `List recommendations failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post(':id/dismiss')
  async dismiss(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await dismissRecommendation(db, {
      recommendationId: id,
      organizationId,
    });
    if (!result.success) {
      this.logger.warn(
        `Dismiss recommendation failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post(':id/action')
  async action(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await markRecommendationActioned(db, {
      recommendationId: id,
      organizationId,
    });
    if (!result.success) {
      this.logger.warn(
        `Action recommendation failed: ${result.error.code} - ${result.error.message}`
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
