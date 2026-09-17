import { db } from '@borradh-workspace/database';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  TrainingHubErrorCodes,
  getTrainingVideo,
  getUserProgress,
  listTrainingVideos,
  markVideoCompleted,
  updateVideoProgress,
} from '@borradh-workspace/features/training-hub';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../common';
import { ListTrainingVideosDto } from './dto/list-training-videos.dto';
import { UpdateVideoProgressDto } from './dto/update-video-progress.dto';

@Controller('training-hub')
@UseGuards(AuthGuard)
export class TrainingHubController {
  private readonly logger = new Logger(TrainingHubController.name);

  @Get('videos')
  async listVideos(
    @CurrentUser('id') userId: string,
    @Query() listDto: ListTrainingVideosDto
  ) {
    this.logger.log(`List training videos request for user: ${userId}`);

    const result = await listTrainingVideos(db, {
      userId,
      category: listDto.category,
    });

    if (!result.success) {
      this.logger.warn(
        `List training videos failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get('videos/:id')
  async getVideo(
    @CurrentUser('id') userId: string,
    @Param('id') videoId: string
  ) {
    this.logger.log(`Get training video request for ID: ${videoId}`);

    const result = await getTrainingVideo(db, {
      userId,
      trainingVideoId: videoId,
    });

    if (!result.success) {
      this.logger.warn(
        `Get training video failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get('progress')
  async getProgress(@CurrentUser('id') userId: string) {
    this.logger.log(`Get user progress request for user: ${userId}`);

    const result = await getUserProgress(db, { userId });

    if (!result.success) {
      this.logger.warn(
        `Get user progress failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post('videos/:id/progress')
  async updateProgress(
    @CurrentUser('id') userId: string,
    @Param('id') trainingVideoId: string,
    @Body() dto: UpdateVideoProgressDto
  ) {
    this.logger.log(
      `Update video progress request for video: ${trainingVideoId}`
    );

    const result = await updateVideoProgress(db, {
      userId,
      trainingVideoId,
      watchedSeconds: dto.watchedSeconds,
    });

    if (!result.success) {
      this.logger.warn(
        `Update video progress failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post('videos/:id/complete')
  async markComplete(
    @CurrentUser('id') userId: string,
    @Param('id') trainingVideoId: string
  ) {
    this.logger.log(
      `Mark video completed request for video: ${trainingVideoId}`
    );

    const result = await markVideoCompleted(db, {
      userId,
      trainingVideoId,
    });

    if (!result.success) {
      this.logger.warn(
        `Mark video completed failed: ${result.error.code} - ${result.error.message}`
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
      case TrainingHubErrorCodes.VIDEO_NOT_FOUND:
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
