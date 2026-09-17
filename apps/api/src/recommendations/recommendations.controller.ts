import { db } from '@borradh-workspace/database';
import {
  type RecommendationsResult,
  getRecommendations,
} from '@borradh-workspace/features/recommendations';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard } from '../common/index.js';
import { GetRecommendationsDto } from './dto/index.js';

@Controller('recommendations')
@UseGuards(AuthGuard)
export class RecommendationsController {
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async getRecommendations(
    @Query() dto: GetRecommendationsDto,
    @ActiveOrganization() organizationId: string
  ): Promise<RecommendationsResult> {
    const result = await getRecommendations(db, {
      organizationId,
      days: dto.days,
      limit: dto.limit,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
      [ErrorCodes.CONFLICT]: HttpStatus.CONFLICT,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
